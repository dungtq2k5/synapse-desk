/**
 * The AI-quota fixture values the ledger, pipeline and scheduled-job suites all
 * assert against.
 *
 * Shared because three suites had declared them independently: a budget that
 * differed between two of them would make "at the cap" mean two different
 * things, and the suite that disagreed would still pass.
 */

/** One dollar, in micros — large enough to exercise a real spend, small enough to exhaust. */
export const BUDGET_MICROS = 1_000_000n;

/** A fixed cycle start, so the Redis quota key is deterministic across suites. */
export const CYCLE_START = new Date('2026-08-01T00:00:00.000Z');
