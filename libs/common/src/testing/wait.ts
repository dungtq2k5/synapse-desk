/**
 * Polling helpers for asserting on work that lands AFTER the call that
 * triggered it.
 *
 * Several paths here are fire-and-forget by design — `AuditPublisher`, the
 * ledger write, the supersede emit — so the row arrives after the method
 * returns. A bare `setImmediate` is not enough: those are real round trips, and
 * asserting immediately fails on timing rather than behaviour.
 *
 * Two shapes, because call sites want different things:
 *
 *   - `waitUntil` RETURNS whether it happened, so the spec asserts on it and
 *     gets "expected true, received false" naming the failure.
 *   - `waitFor` THROWS, for a setup step that must have completed before the
 *     interesting assertions run.
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
