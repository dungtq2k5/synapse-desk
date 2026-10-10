/** @file What the two `/platform/finance` routes return. */

export class FinanceTenantCountsResponseDto {
  readonly total!: number;
  /**
   * Keyed by status, so a new status needs no new field.
   *
   * **`ACTIVE` here is not `activeSubscriptions` below.** The Stripe status
   * mapping folds `trialing` into `ACTIVE`, and the revenue estimate counts
   * `status: 'active'` subscriptions only. Two populations, one adjective —
   * subtracting one from the other produces a number that means nothing.
   */
  readonly byStatus!: Record<string, number>;
}

export class FinancePlanMixResponseDto {
  readonly planId!: string;
  readonly planName!: string;
  /**
   * Live subscribers — **not** `SubscriptionPlanResponseDto.subscriberCount`.
   *
   * That one is unfiltered and counts soft-deleted tenants, because
   * `DELETE /platform/plans/:id` reads it to refuse retiring a plan somebody
   * still points at and an offboarded tenant can be restored. This one excludes
   * them, because an offboarded tenant is not a subscriber and the same
   * response's `tenants.total` excludes them too.
   */
  readonly subscribers!: number;
  /** Summed from what tenants HOLD, so pinned and overridden grants count. */
  readonly seatsAllocated!: number;
}

export class DunningTenantResponseDto {
  readonly id!: string;
  readonly name!: string;
  /**
   * When the tenant row last changed — **not when it went past due**.
   *
   * `organizations` has no status-change timestamp, so this is the closest
   * available fact and a rename or a quota edit moves it. Rendering it as a
   * dunning age would be a confidently wrong number.
   */
  readonly updatedAt!: Date;
}

export class FinanceDunningResponseDto {
  readonly pastDue!: number;
  readonly tenants!: DunningTenantResponseDto[];
}

export class FinanceRevenueResponseDto {
  readonly available!: boolean;
  /** Present exactly when `available` is false. */
  readonly unavailableReason!: string | null;
  /** Smallest currency unit. Annual prices divided by twelve. */
  readonly estimatedMrr!: number | null;
  /** NULL when there are no active subscriptions to take one from. */
  readonly currency!: string | null;
  readonly activeSubscriptions!: number | null;
  /** When the JOB read Stripe — never when this endpoint answered. */
  readonly computedAt!: Date | null;
  /**
   * The caveats, traveling with the number.
   *
   * On the wire deliberately: a field called `mrr` gets quoted in a meeting,
   * and a caveat that lives in a document nobody opens beside the chart is not
   * a caveat. Present on every response, including the ones with no number.
   */
  readonly excludes!: string[];
}

export class FinanceSnapshotResponseDto {
  readonly tenants!: FinanceTenantCountsResponseDto;
  readonly plans!: FinancePlanMixResponseDto[];
  readonly dunning!: FinanceDunningResponseDto;
  readonly revenue!: FinanceRevenueResponseDto;
  /** When this response was assembled; see `revenue.computedAt` for the snapshot's age. */
  readonly generatedAt!: Date;
}

export class BillingEventPointResponseDto {
  /** `YYYY-MM-DD`, UTC. */
  readonly day!: string;
  /**
   * **A string, and it carries two vocabularies.**
   *
   * In `points` it is Stripe's (`invoice.payment_failed`); in
   * `currentlyOffboarded` it is `organization.offboarded`, which this system
   * invented. A client writing a `switch` over this field will meet both.
   */
  readonly eventType!: string;
  readonly count!: number;
}

export class BillingEventsResponseDto {
  readonly points!: BillingEventPointResponseDto[];
  /**
   * Tenants CURRENTLY offboarded, bucketed by the day they were offboarded — a
   * different ending from a cancellation.
   *
   * **Named for the state rather than the event, deliberately.** It is derived
   * from `organizations.deleted_at`, which a restore clears, so restoring a
   * tenant removes it from every past range. As an event count that would be a
   * series rewriting its own history; as a projection of current state it
   * behaves as named. A stable churn line needs the audit log, which lives in
   * another service.
   */
  readonly currentlyOffboarded!: BillingEventPointResponseDto[];
  /**
   * The event types actually seen in this range.
   *
   * A type that has never arrived is visibly absent here rather than reported
   * as a zero — and which types arrive at all is the Stripe endpoint's
   * `enabled_events`, which nothing in this repository configures.
   */
  readonly observedEventTypes!: string[];
}
