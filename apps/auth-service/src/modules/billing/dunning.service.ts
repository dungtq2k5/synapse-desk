import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  CreateInAppNotificationCommand,
  IN_APP_NOTIFICATION_PATTERN,
  JetStreamPublisher,
  NOTIFICATION_TYPES,
  NotificationPriority,
  NotificationResourceType,
  formatErrorMsg,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Failed payments — the only event here where the tenant LOSES ACCESS, and the
 * only one with a deadline.
 *
 * **Its own consumer, not a wider allowlist**, and that is the whole design.
 * `EntitlementWriterService.HANDLED_EVENT_TYPES` is narrow on purpose: adding
 * `invoice.payment_failed` to it would feed an INVOICE into a writer that reads
 * `event.data.object` as a `Subscription` and derives entitlements from its
 * price — applying a plan from an object that does not describe one.
 *
 * The repo already gets part of the way: `past_due` maps to
 * `SUSPENDED_PAST_DUE` and arrives on `customer.subscription.updated`. What
 * lives only on the invoice is the *reason*, the retry schedule, and whether
 * this was the final attempt — which is the difference between "we will try
 * again on the 14th" and "your workspace is about to be suspended".
 */
@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jetstream: JetStreamPublisher,
  ) {}

  /**
   * Notifies a tenant that a payment did not go through.
   *
   * **Does not touch entitlements.** Suspension arrives separately, on the
   * subscription event Stripe sends alongside — this path exists to tell
   * somebody, not to change what they are entitled to.
   *
   * @param event a `invoice.payment_failed`, already claimed in `billing_events`.
   * @returns whether a tenant was resolved; an unmatched customer is recorded
   * and dropped, exactly as the entitlement path treats one.
   */
  async handle(
    event: Stripe.Event,
  ): Promise<{ organizationId: string | null }> {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : (invoice.customer?.id ?? null);

    const organization = customerId
      ? await this.prisma.organization.findUnique({
          where: { stripeCustomerId: customerId },
          select: { id: true },
        })
      : null;

    if (!organization) {
      // Recorded by the caller with `organization_id = NULL`. Loud enough to
      // find during an incident, quiet enough not to page: a payment failing
      // for a customer we cannot resolve is a data problem, not the tenant's.
      this.logger.warn(
        `invoice.payment_failed for unresolved customer ${customerId ?? '(none)'}`,
      );

      return { organizationId: null };
    }

    this.publish(organization.id, event, invoice);

    return { organizationId: organization.id };
  }

  private publish(
    organizationId: string,
    event: Stripe.Event,
    invoice: Stripe.Invoice,
  ): void {
    try {
      // **Derived from the Stripe EVENT id**, not generated: Stripe retries a
      // failed webhook, and every retry must collapse onto one notification.
      // The same string is the message id and the `event_id`, so the stream's
      // window and Domain E's durable constraint agree by construction.
      const eventId = `dunning:${event.id}`;
      const nextAttempt = nextAttemptOf(invoice);

      const command: CreateInAppNotificationCommand = {
        organizationId,
        type: NOTIFICATION_TYPES.paymentFailed,
        // Whoever can fix it. An agent cannot update a card.
        audience: { kind: 'permission', permission: 'organization.update' },
        eventId,
        title: 'A payment did not go through',
        body: nextAttempt
          ? `We could not take payment for your subscription. Stripe will try again on ${nextAttempt}. Updating your payment method before then avoids any interruption.`
          : 'We could not take payment for your subscription, and this was the final attempt. Your workspace may be suspended until a working payment method is added.',
        // **Always CRITICAL**, unlike the threshold alerts where only 100% is.
        // Every one of these has a deadline attached, and a dunning notice
        // batched into a digest arrives after the suspension it warned about.
        priority: NotificationPriority.CRITICAL,
        occurredAt: new Date(event.created * 1000).toISOString(),
        resourceType: NotificationResourceType.ORGANIZATION,
        resourceId: organizationId,
        actionUrl: '/settings/billing',
        data: {
          nextAttempt,
          amountDue: invoice.amount_due,
          currency: invoice.currency,
          attemptCount: invoice.attempt_count,
        },
      };

      this.jetstream.publish(IN_APP_NOTIFICATION_PATTERN, command, eventId);
    } catch (error) {
      // A notification that cannot be published must not fail the webhook —
      // Stripe would retry it, and the entitlement side has already settled.
      this.logger.error(
        `Could not publish the dunning notice for ${organizationId}: ${formatErrorMsg(error)}`,
      );
    }
  }
}

/**
 * When Stripe will try again, as a date, or `null` when it will not.
 *
 * `next_payment_attempt` is UNIX SECONDS and absent on the final attempt —
 * which is the distinction the notification turns on, so it is read here rather
 * than defaulted to "soon".
 *
 * **Rendered in UTC, not in `Organization.timezone`.** Known imprecision: a
 * UTC+7 tenant whose retry falls just after midnight local reads a date one day
 * early. Accepted here because the date is advisory — "before then" is the
 * actionable part — and because the alternative is a second query on the
 * webhook path for a field that only formats a string. Worth revisiting if
 * dunning ever quotes a TIME rather than a day.
 */
function nextAttemptOf(invoice: Stripe.Invoice): string | null {
  const next = invoice.next_payment_attempt;

  return next ? new Date(next * 1000).toISOString().slice(0, 10) : null;
}
