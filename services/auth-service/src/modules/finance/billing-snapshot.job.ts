import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { RevenueUnavailableReason } from '@synapsedesk/common';
import { StripeService } from '../billing/stripe.service';
import {
  BillingSnapshotStore,
  type RevenueSnapshot,
} from './billing-snapshot.store';

/** Months in one billing period, for the intervals this estimate can price. */
const MONTHS_PER_INTERVAL: Readonly<Record<string, number>> = {
  month: 1,
  year: 12,
};

/**
 * Reads active subscriptions from Stripe and stores the revenue snapshot.
 *
 * **The endpoint never runs this.** `GET /platform/finance` reads what this
 * leaves behind, because `subscriptions.list` pages at 100 and the read grows
 * linearly with tenants — a dashboard that fans out to a third party on every
 * load fails when they do, and this is a page somebody opens when something is
 * already wrong.
 *
 * **Its own scheduled job rather than a step on `AUTH_HOURLY`**, and the
 * heartbeat is what decides it: `JobRunRecorder.track` records one row per JOB,
 * so a Stripe outage folded into that job would report invitation expiry as
 * failing in `/platform/jobs` — a job that ran perfectly, red because something
 * unrelated shares its heartbeat.
 */
@Injectable()
export class BillingSnapshotJob {
  private readonly logger = new Logger(BillingSnapshotJob.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly store: BillingSnapshotStore,
  ) {}

  /**
   * One run.
   *
   * **A deployment with no `STRIPE_SECRET_KEY` is a SUCCESS, not a failure.**
   * The key is optional by design — every tenant stays grandfathered and the
   * service boots — so an hourly job that threw here would make
   * `/platform/jobs` permanently red on every developer machine and on any
   * billing-disabled deployment. Within a week that is a red row people learn
   * to scroll past, which costs more than the row was ever worth. The job did
   * its work; there was nothing to fetch, and the endpoint says so.
   *
   * Anything else that fails is left to throw, so a credential that stops
   * working on a *configured* deployment shows up as a stale job rather than as
   * a quietly frozen number.
   */
  async run(): Promise<void> {
    if (!this.stripe.isConfigured) {
      this.logger.log(
        'Stripe is not configured; recording an empty revenue snapshot',
      );

      await this.store.write({
        available: false,
        reason: RevenueUnavailableReason.NOT_CONFIGURED,
        computedAt: new Date().toISOString(),
      });

      return;
    }

    await this.store.write(await this.compute());
  }

  /**
   * The estimate.
   *
   * **Never persisted as revenue, and never derived from a webhook.** Consuming
   * `invoice.paid` into a running total would be a mirror by another name: it
   * drifts on refunds, disputes, credits and currency, cannot be recomputed
   * after the fact, and is the wrong number the first time it disagrees with
   * Stripe's own dashboard. This is arithmetic over a live read that is thrown
   * away — the shape `listInvoices` already establishes.
   */
  private async compute(): Promise<RevenueSnapshot> {
    const computedAt = new Date().toISOString();

    let monthlyTotal = 0;
    let subscriptions = 0;
    let currency: string | null = null;

    // `for await` pages automatically. `limit: 100` is the ceiling per page,
    // not the total: without the iteration this silently reports the revenue of
    // the first hundred tenants as the revenue of all of them, and the number
    // stays plausible the entire time.
    for await (const subscription of this.stripe.api.subscriptions.list({
      status: 'active',
      limit: 100,
    })) {
      subscriptions += 1;

      for (const item of subscription.items.data) {
        const monthly = monthlyAmount(item);
        if (monthly === null) {
          // **The id, because the reason code names only the category.** Both
          // refusals below are all-or-nothing: one usage-based plan removes
          // `estimatedMrr` for the whole platform, and an operator staring at a
          // blank chart otherwise has no first step among ten thousand
          // subscriptions.
          this.logger.warn(
            `Subscription ${subscription.id} cannot be priced (item ${item.id}); the revenue estimate is unavailable platform-wide`,
          );

          return {
            available: false,
            reason: RevenueUnavailableReason.UNSUPPORTED_PRICING,
            computedAt,
          };
        }

        // **Refused, not converted.** Adding 100 USD to 100 EUR produces 200 of
        // nothing, and it is the fastest available route to a confidently wrong
        // figure. Conversion would need a rate this system does not have and a
        // date it would have to choose.
        if (currency !== null && item.price.currency !== currency) {
          this.logger.warn(
            `Subscription ${subscription.id} is billed in ${item.price.currency}, not ${currency}; the revenue estimate is unavailable platform-wide`,
          );

          return {
            available: false,
            reason: RevenueUnavailableReason.MIXED_CURRENCIES,
            computedAt,
          };
        }

        currency = item.price.currency;
        monthlyTotal += monthly;
      }
    }

    return {
      available: true,
      // Rounded to the smallest currency unit. Annual prices divided by twelve
      // do not land on whole cents, and reporting a fraction of a cent would
      // imply a precision the estimate does not have.
      estimatedMrr: Math.round(monthlyTotal),
      // **`null` rather than `''` when there are no active subscriptions.**
      // There is no currency to report, and an empty string would reach a
      // client that formats money with it — the `?? ''` shape this repository
      // keeps finding, where an absent value is typed as a present one.
      currency,
      activeSubscriptions: subscriptions,
      computedAt,
    };
  }
}

/**
 * One subscription item's contribution to MRR, or `null` when it cannot be
 * priced.
 *
 * `interval_count` is included because Stripe supports "every three months",
 * and reading only `interval` would count that at three times its real monthly
 * value.
 */
function monthlyAmount(item: Stripe.SubscriptionItem): number | null {
  const { price, quantity } = item;

  // Tiered and metered prices carry no `unit_amount`. There is no honest single
  // number for one without replaying usage, which is the invoice's job.
  if (price.unit_amount === null || !price.recurring) return null;

  const months =
    MONTHS_PER_INTERVAL[price.recurring.interval] *
    price.recurring.interval_count;

  // `day` and `week` are absent from the table above, so this is NaN for them
  // rather than an invented 30.44-day month.
  if (!Number.isFinite(months) || months <= 0) return null;

  return (price.unit_amount * (quantity ?? 1)) / months;
}
