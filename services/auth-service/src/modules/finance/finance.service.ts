import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  BillingEventSource,
  MAX_FINANCE_RANGE_DAYS,
  OrgStatus,
  REVENUE_EXCLUSIONS,
  compareAlphabetically,
} from '@synapsedesk/common';
import { toProtoTimestamp } from '@synapsedesk/grpc-proto';
import type {
  FinanceSnapshotResponse,
  ListBillingEventsRequest,
  ListBillingEventsResponse,
} from '@synapsedesk/grpc-proto';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BillingSnapshotStore,
  type SnapshotRead,
} from './billing-snapshot.store';

/**
 * **The one place the two-producer filter is written.**
 *
 * `billing_events` has a second writer: a plan change claims a `LOCAL` row
 * before calling Stripe. Every finance query filters it out, and this is a
 * shared constant rather than a clause each handler remembers, because a second
 * local producer is a matter of time and `source: 'STRIPE'` stays correct when
 * it arrives — a negative filter would not.
 *
 * **What makes forgetting it worse than an obvious bug.** A `LOCAL` row is a
 * LOCK, released in a `finally`, so it exists only while a plan change is in
 * flight. An unfiltered query is therefore correct almost always and wrong only
 * mid-request: a constant inflation gets noticed, an intermittent one produces
 * a number that is right whenever anybody checks it and wrong on the day it is
 * quoted.
 */
// Exported for the cross-check in `finance.e2e-spec`: the aggregation spells
// the column name in SQL and this spells it in Prisma, so a test runs both over
// the same rows and compares. That is the one exposure `$queryRaw` genuinely
// adds, and it is pinned rather than argued about.
export const STRIPE_EVENTS: Prisma.BillingEventWhereInput = {
  source: BillingEventSource.STRIPE,
};

/**
 * The same discriminator as a bound SQL parameter.
 *
 * One spelling of the VALUE across both paths — the aggregation binds this,
 * never a literal — so §2's guard stays a compile-time reference. What the two
 * paths do not share is the column name, which `finance.e2e-spec` pins by
 * running both and comparing.
 */
const STRIPE_SOURCE: string = BillingEventSource.STRIPE;

/**
 * The type name the offboarding series carries.
 *
 * **This system's vocabulary, not Stripe's** — and it shares
 * `BillingEventPoint.event_type` with Stripe's, which is one of the reasons
 * that field is a `string` rather than an enum: an enum would have to span both
 * namespaces.
 */
const OFFBOARDED_EVENT_TYPE = 'organization.offboarded';

/** One grouped `(day, eventType)` row, as both queries project it. */
type DayCount = { day: string; eventType: string; count: number };

/** Milliseconds in a day, for the range check. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The finance figures auth-service owns.
 *
 * **Everything here is one query against auth's own tables**, none of it
 * touches Stripe, and none of it can be stale. The revenue estimate is the
 * exception and it is not computed here — it is read from the snapshot the
 * hourly job leaves behind, so a Stripe outage costs one section rather than
 * the page.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: BillingSnapshotStore,
  ) {}

  async getSnapshot(): Promise<FinanceSnapshotResponse> {
    const now = new Date();

    const [total, byStatus, plans, pastDueTenants, snapshot] =
      await Promise.all([
        this.prisma.organization.count({ where: { deletedAt: null } }),
        this.prisma.organization.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        this.liveSubscribersByPlan(),
        this.prisma.organization.findMany({
          where: { deletedAt: null, status: OrgStatus.SUSPENDED_PAST_DUE },
          select: { id: true, name: true, updatedAt: true },
          orderBy: { updatedAt: 'asc' },
        }),
        this.snapshots.read(),
      ]);

    return {
      tenants: {
        total,
        byStatus: Object.fromEntries(
          byStatus.map((row) => [row.status, row._count._all]),
        ),
      },
      plans,
      dunning: {
        pastDue: pastDueTenants.length,
        tenants: pastDueTenants.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          updatedAt: toProtoTimestamp(tenant.updatedAt),
        })),
      },
      revenue: this.toRevenue(snapshot),
      generatedAt: toProtoTimestamp(now),
    };
  }

  /**
   * Subscribers per plan — **finance's own count, not `_count.organizations`**.
   *
   * `PLAN_INCLUDE` counts subscribers with no `deleted_at` filter, and that is
   * correct where it is used: `deletePlan` refuses to retire a plan while
   * anything points at it, and an offboarded tenant can be RESTORED — filtering
   * there would let a plan be retired out from under a tenant whose `plan_id`
   * would then dangle.
   *
   * Finance asks a different question. An offboarded tenant is not a
   * subscriber, and the same response carries `tenants.total`, which excludes
   * them — reusing the unfiltered count would put two populations in one
   * response under one word.
   *
   * Three consumers, three correct answers, so three definitions. That is the
   * opposite of the usual rule in this repository and it is right here for the
   * reason the usual rule exists: one definition per QUESTION.
   *
   * **`seatsAllocated` is summed from the TENANTS**, never `plan.maxAgentSeats`
   * multiplied by subscribers. The two diverge for every tenant with
   * `entitlementsPinned` or a manual override — precisely the population a plan
   * apply does not touch — and this is what tenants hold, which is also the
   * definition `GetMetrics.seatsAllocated` uses.
   */
  private async liveSubscribersByPlan(): Promise<
    FinanceSnapshotResponse['plans']
  > {
    const grouped = await this.prisma.organization.groupBy({
      by: ['planId'],
      where: { deletedAt: null, planId: { not: null } },
      _count: { _all: true },
      _sum: { maxAgentSeats: true },
    });

    const planIds = grouped.map((row) => row.planId as string);
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true },
    });
    const names = new Map(plans.map((plan) => [plan.id, plan.name]));

    return grouped
      .map((row) => ({
        planId: row.planId as string,
        // A plan row deleted while tenants still point at it: `deletePlan`
        // refuses that, so this is a fallback for a hand-edited database rather
        // than a reachable state, and a blank name would read as a rendering
        // bug rather than as data.
        planName: names.get(row.planId as string) ?? '(unknown plan)',
        subscribers: row._count._all,
        seatsAllocated: row._sum.maxAgentSeats ?? 0,
      }))
      .sort((a, b) => b.subscribers - a.subscribers);
  }

  /** The snapshot, or which of four reasons there is not one. */
  private toRevenue(read: SnapshotRead): FinanceSnapshotResponse['revenue'] {
    // The caveats travel with the number in EVERY branch, including the ones
    // with no number: a client renders the exclusions beside the section
    // heading, and a section that sometimes omits them teaches the reader they
    // are optional.
    const excludes = [...REVENUE_EXCLUSIONS];

    // **The store's own reason, not a fixed one.** This used to map every
    // falsy read to `NO_SNAPSHOT`, which is a claim about the job — reported,
    // in the outage case, while `/platform/jobs` showed the job green and
    // forty minutes fresh. No reading of those two surfaces together was
    // correct.
    if (!read.ok) {
      return { available: false, unavailableReason: read.why, excludes };
    }

    const { snapshot } = read;

    if (!snapshot.available) {
      return {
        available: false,
        unavailableReason: snapshot.reason,
        computedAt: toProtoTimestamp(new Date(snapshot.computedAt)),
        excludes,
      };
    }

    return {
      available: true,
      estimatedMrr: snapshot.estimatedMrr,
      // `?? undefined`, never `?? ''` — the rule `plan.mapper.ts` states for
      // `stripeProductId`. A tenant-less deployment has no currency, and an
      // empty string would reach a client that formats money with it.
      currency: snapshot.currency ?? undefined,
      activeSubscriptions: snapshot.activeSubscriptions,
      computedAt: toProtoTimestamp(new Date(snapshot.computedAt)),
      excludes,
    };
  }

  /**
   * The event series — **local only, and therefore always answerable**.
   *
   * That is why it is a separate RPC from the snapshot: when Stripe is down the
   * revenue section degrades and this still answers, which is exactly when
   * somebody wants to look at it.
   *
   * **Aggregated in Postgres, not in memory.** An earlier version selected the
   * rows and grouped them in TypeScript, justified by "the range is bounded".
   * A day bound is not a row bound: the result is days x tenants x
   * events-per-tenant, and Stripe emits several events per subscription per
   * month, so a year across a thousand tenants materialises tens of thousands
   * of rows to produce at most a few hundred points.
   *
   * **The `AnalyticsService` precedent supports the technique and not the
   * shape.** It groups per day in memory too — over `ticketDailyStat`, which a
   * nightly job pre-aggregates to one row per tenant per day, so that read
   * returns `days` rows. This one read the raw event table.
   *
   * **And the objection to `$queryRaw` was overstated.** A tagged template
   * binds the value as a parameter, so {@link STRIPE_SOURCE} still has exactly
   * one spelling and the compiler still sees it. What duplicates is the COLUMN
   * NAME — `source` as SQL text beside `source` as a Prisma field — which
   * `finance.e2e-spec` pins by running both paths over the same rows and
   * comparing.
   */
  async listEvents(
    request: ListBillingEventsRequest,
  ): Promise<ListBillingEventsResponse> {
    const { from, to } = this.range(request);

    const [points, currentlyOffboarded] = await Promise.all([
      this.prisma.$queryRaw<DayCount[]>`
        SELECT to_char(stripe_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               event_type AS "eventType",
               COUNT(*)::int AS count
        FROM billing_events
        WHERE source = ${STRIPE_SOURCE}
          AND stripe_created_at >= ${from}
          AND stripe_created_at < ${to}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
      // **A projection of CURRENT STATE, and the name is the whole disclosure.**
      // `organizations.deleted_at` is cleared by `restoreOrganization`, so
      // restoring a tenant removes it from every past range — including months
      // already read and quoted. Called `offboardings` that was a defect: an
      // event count that shrinks. Called `currentlyOffboarded` it is a
      // specification, and this query is what that name says.
      //
      // A stable churn series needs an append-only source —
      // `PLATFORM_ORGANIZATION_OFFBOARDED` in `audit_logs`, which lives in
      // ticket-service and is a cross-service read this surface does not have.
      // Deliberately not built here; the rename is what stops the number being
      // read as history in the meantime.
      this.prisma.$queryRaw<DayCount[]>`
        SELECT to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               ${OFFBOARDED_EVENT_TYPE} AS "eventType",
               COUNT(*)::int AS count
        FROM organizations
        WHERE deleted_at >= ${from}
          AND deleted_at < ${to}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
    ]);

    return {
      points,
      currentlyOffboarded,
      // **What was SEEN, so a type that never arrives is visibly absent rather
      // than zero.** Which types arrive at all is the Stripe endpoint's
      // `enabled_events`, and nothing in this repository sets it — so "no
      // cancellations this month" and "cancellations were never enabled" render
      // identically without this field.
      //
      // Derived from the grouped result rather than a second query: the points
      // already name every type present, one per group.
      observedEventTypes: [
        ...new Set(points.map((point) => point.eventType)),
      ].sort(compareAlphabetically),
    };
  }

  /**
   * Both bounds, validated.
   *
   * `to` is INCLUSIVE on the wire and exclusive in the query. A caller asking
   * for the 1st through the 31st means the whole month, and a half-open bound
   * would silently drop the last day of every range anybody types.
   */
  private range(request: ListBillingEventsRequest): { from: Date; to: Date } {
    const from = new Date(`${request.from}T00:00:00.000Z`);
    const to = new Date(`${request.to}T00:00:00.000Z`);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'from and to must be ISO dates (YYYY-MM-DD)',
      });
    }

    if (to < from) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'to must not be before from',
      });
    }

    const days = (to.getTime() - from.getTime()) / DAY_MS + 1;
    if (days > MAX_FINANCE_RANGE_DAYS) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `The range must not exceed ${MAX_FINANCE_RANGE_DAYS} days`,
      });
    }

    return { from, to: new Date(to.getTime() + DAY_MS) };
  }
}
