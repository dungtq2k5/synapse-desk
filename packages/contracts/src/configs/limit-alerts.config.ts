/**
 * @file Threshold alerts for the dimensions that are LEVELS rather than meters.
 *
 * **Two mechanisms, chosen by whether the dimension resets.** The AI budget is
 * METERED: it accumulates monotonically inside a billing cycle, and the cycle
 * roll changes `billingCycleStart`, which mints a fresh event id and re-arms
 * every threshold for free. That is why `quotaThresholdEventId` works and why
 * it is not touched here.
 *
 * Seats, storage and document count are LEVELS. They move both ways and there
 * is no cycle to reset anything, so a per-threshold claim is wrong in both
 * available directions: made permanent it alerts once ever, and given a TTL it
 * nags a tenant parked at 81% forever.
 *
 * **A new dimension belongs in exactly one of the two.** Ask whether it resets
 * on its own: if it does, it wants `quotaThresholdEventId`; if it does not, it
 * wants the level alarm below.
 */

/**
 * The dimensions that have an "approaching" state at all.
 *
 * **The same three members as `PLAN_LIMIT_DIMENSIONS` today, and a different
 * question.** That one means "limits a plan apply can put a tenant OVER", which
 * is why it excludes `analytics` — narrowing a lookback window has no
 * over-limit subset. This one means "dimensions a tenant can be 80% of", which
 * is why it excludes `maxDocumentBytes` and `maxAttachmentBytes`: they are
 * per-file gates, so nobody is ever approaching one.
 *
 * Kept separate because merging them makes an addition to either silently an
 * addition to both, and the two failure modes are not alike: a dimension added
 * here with no producer alerts on nothing, silently; a dimension added there
 * with no evaluator is REPORTED as unevaluated, by design. One fails open, one
 * is instrumented.
 *
 * `limit-alerts.config.spec.ts` asserts the two lists currently agree — so a
 * divergence is a deliberate edit rather than a drift, and the test's failure
 * message is where this reasoning gets read again.
 */
export const LIMIT_ALERT_DIMENSIONS = [
  'seats',
  'storage',
  'documents',
] as const;
export type LimitAlertDimension = (typeof LIMIT_ALERT_DIMENSIONS)[number];

/**
 * The same ladder the AI budget uses, deliberately.
 *
 * A tenant who learns their storage warnings arrive at 80/95/100 and their
 * budget warnings at different numbers has to hold two models of one product.
 */
export const LIMIT_ALERT_THRESHOLDS = [80, 95, 100] as const;

/**
 * How far a level must FALL below a threshold before that threshold re-arms.
 *
 * Without a band, a tenant hovering on the boundary — 80.1%, 79.9%, 80.1% —
 * would alert on every crossing. Ten points is wide enough that clearing back
 * below it is a deliberate act (deleting documents, removing an agent) rather
 * than noise.
 */
export const LIMIT_ALERT_HYSTERESIS_BAND = 10;

/**
 * The Redis key holding a dimension's current alarm LEVEL.
 *
 * **Level only. The generation lives in Postgres**, and the split is not a
 * storage preference — see {@link limitThresholdEventId}. A level is cheap to
 * reconstruct: the next reading recomputes it, and the worst a lost one causes
 * is one duplicate alert that the durable guard then collapses. A generation is
 * not reconstructible from anything.
 *
 * **No TTL.** An expiry would silently re-arm the alarm and reintroduce exactly
 * the nagging this design removes. Losing the key to a flush is survivable for
 * the reason above; losing it to a clock is a design that nags.
 *
 * `offboardOrganization` clears these, so a departed tenant leaves nothing
 * behind — but nothing load-bearing is in here, which is what makes that a
 * tidiness step rather than a correctness one.
 */
export function limitAlertStateKey(
  organizationId: string,
  dimension: LimitAlertDimension,
): string {
  return `limit-alert:${organizationId}:${dimension}`;
}

/** Every dimension's key for one tenant — what offboarding clears. */
export function limitAlertStateKeys(organizationId: string): string[] {
  return LIMIT_ALERT_DIMENSIONS.map((dimension) =>
    limitAlertStateKey(organizationId, dimension),
  );
}

/**
 * The alarm's state: the highest threshold currently alerted, and how many
 * times this dimension has re-armed.
 *
 * **The two halves are stored in different places, and that is a correctness
 * requirement rather than a preference.** `level` is Redis; `generation` is
 * Postgres. {@link limitThresholdEventId} explains why.
 */
export type LimitAlertState = { level: number; generation: number };

/** A tenant nothing has alerted about yet. */
export const INITIAL_LIMIT_ALERT_STATE: LimitAlertState = {
  level: 0,
  generation: 0,
};

/**
 * The `notifications.event_id` for a level alert.
 *
 * Two requirements that pull against each other, and the generation is the
 * minimal thing satisfying both:
 *
 * - **Derived, never generated**, so a NATS redelivery of one crossing collapses
 *   and Domain E's `UNIQUE (recipient_id, event_id)` has something to match on.
 *   A timestamp taken at publish time would break this.
 * - **Distinct per OCCURRENCE**, so a genuine re-crossing is a new event. The
 *   durable guard is permanent — nothing sweeps `notifications` — so republishing
 *   the id from the first crossing is rejected as a duplicate, and the tenant is
 *   never told. Hysteresis re-arms the LOCAL alarm and does nothing about that.
 *
 * **This is why `generation` lives in Postgres and not beside the level in
 * Redis.** A generation defeats a permanent guard, so it must be at least as
 * long-lived as the guard it steps past. In Redis, a flush resets it to zero,
 * the next crossing republishes an id the constraint already holds, and the
 * tenant silently stops receiving that alert FOREVER — from a transient failure,
 * with nothing anywhere reporting it.
 *
 * @param generation the dimension's re-arm count, read from the durable store.
 */
export function limitThresholdEventId(
  organizationId: string,
  dimension: LimitAlertDimension,
  threshold: number,
  generation: number,
): string {
  return `limit:${organizationId}:${dimension}:${threshold}:${generation}`;
}

/**
 * What a new reading means for the alarm — the whole of the hysteresis rule.
 *
 * Pure and synchronous so both services share one implementation and a test can
 * drive it without Redis.
 *
 * @param percent used ÷ limit × 100, already computed by the caller.
 * @param state the dimension's stored level and generation.
 * @returns the thresholds to ALERT on and the state to store. `alerts` is empty
 * whenever nothing crossed, which is the ordinary case.
 *
 * @example
 * // parked at 81% with the 80 alarm raised — nothing fires
 * evaluateLimitAlert(81, { level: 80, generation: 0 })
 * // → { alerts: [], state: { level: 80, generation: 0 } }
 */
export function evaluateLimitAlert(
  percent: number,
  state: LimitAlertState,
): { alerts: number[]; state: LimitAlertState } {
  // **Clearing happens first**, and the band is what stops a tenant hovering on
  // the boundary alerting on every reading.
  //
  // `<=` and not `<`: a threshold clears AT `threshold - band`, so 80 re-arms
  // at 70 rather than at 69.9. The exclusive reading makes the obvious worked
  // example — "fall to 70%, climb back to 85%" — silently not re-arm, which is
  // a rule people get wrong because the canonical case is the failing one.
  const stillRaised = LIMIT_ALERT_THRESHOLDS.filter(
    (threshold) =>
      threshold <= state.level &&
      percent > threshold - LIMIT_ALERT_HYSTERESIS_BAND,
  );

  const cleared =
    state.level > 0 && stillRaised.length === 0
      ? true
      : LIMIT_ALERT_THRESHOLDS.some(
          (threshold) =>
            threshold <= state.level &&
            percent <= threshold - LIMIT_ALERT_HYSTERESIS_BAND,
        );

  // The highest threshold STILL alerted — zero when everything cleared, which
  // is what "nothing is currently alerted" means. Carrying `min(cleared) - 1`
  // instead would behave the same and read as a threshold nobody configured.
  const level = stillRaised.length > 0 ? Math.max(...stillRaised) : 0;

  // A re-arm is a NEW generation, counted once per RECOVERY rather than once
  // per threshold cleared: falling from 100% to 5% is one recovery, not three,
  // and a generation that skipped values would be a step counter nobody could
  // explain later.
  const generation = cleared ? state.generation + 1 : state.generation;

  const alerts = LIMIT_ALERT_THRESHOLDS.filter(
    (threshold) => percent >= threshold && threshold > level,
  );

  return {
    alerts: [...alerts],
    state: {
      level: alerts.length > 0 ? Math.max(...alerts) : level,
      generation,
    },
  };
}
