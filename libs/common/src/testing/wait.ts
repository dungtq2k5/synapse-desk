/**
 * Polling helpers for asserting on work that lands AFTER the call that
 * triggered it.
 *
 * Several paths in this system are fire-and-forget by design — `AuditPublisher`,
 * the ledger write, the supersede emit — so the row they write arrives after
 * the method returns. A bare `setImmediate` is not enough: those are real round
 * trips to Postgres or Redis, and asserting immediately makes a test fail on
 * timing rather than on behaviour.
 *
 * Two shapes, because the call sites genuinely want different things, and that
 * difference is exactly what had been copied into two near-identical local
 * helpers:
 *
 *   - `waitUntil` RETURNS whether it happened, so the spec can assert on it and
 *     get "expected true, received false" naming the assertion that failed.
 *   - `waitFor` THROWS, for the setup step that must have completed before the
 *     interesting assertions run — there, a boolean nobody checks would let the
 *     real failure surface later and somewhere else.
 *
 * **Test-only**: excluded from this library's build.
 */

/** How often to re-check. Short enough to not dominate a fast pass. */
const POLL_INTERVAL_MS = 25;

/** Polls until `predicate` holds, and reports WHETHER it did. */
export async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return false;
}

/**
 * Polls until `predicate` holds, THROWING if it never does.
 *
 * The message names the timeout because the alternative — a test that proceeds
 * on an unmet precondition — fails later, on an assertion that had nothing to
 * do with the cause.
 */
export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 5_000,
): Promise<void> {
  if (await waitUntil(predicate, timeoutMs)) return;

  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
