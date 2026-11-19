/**
 * The log lines the gateway writes when a protection or a cache fails open:
 * Redis answered with an error and the gateway carried on without it. In a
 * test run none of them should appear, because the stack's Redis is up. One
 * that does means a write the store refused, which the gateway reads as an
 * outage, as `SET … PX 0` did for the socket limits.
 *
 * Each entry is the start of the message, as the gateway logs it.
 */
export const FAIL_OPEN_LINES = [
  // The rate limits: their protection is off while the line repeats.
  'Rate-limit storage unavailable',
  'Handshake throttle storage unavailable',
  'Event throttle storage unavailable',
  // The entity cache: answers go uncached, or a write is not evicted.
  'Cache read failed',
  'Cache write failed',
  'Cache mget failed',
  'Cache msetEx failed',
  'Cache invalidation failed',
  'Cache generation increment failed',
  'Cache scope invalidation failed',
  'Cache generations unreadable',
  // The organization-status cache.
  'Status cache unavailable',
  'Could not invalidate cached status',
  // Revoked sessions: a signed-out device keeps working.
  'Revoked-session check unavailable',
  'Revoked-session sweep unavailable',
] as const;

/** The fail-open lines in some log output, each as logged. */
export function failOpenLines(
  output: string,
  allowed: readonly string[] = [],
): string[] {
  return output
    .split('\n')
    .filter((line) =>
      FAIL_OPEN_LINES.some(
        (start) =>
          line.includes(start) &&
          !allowed.some((declared) => line.includes(declared)),
      ),
    );
}
