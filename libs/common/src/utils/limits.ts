/**
 * The guard on the COMPARISON, rather than on each route into it.
 *
 * Every size check in the system is `value > limit`, and every limit reaches it
 * through a `Math.min` over layers that arrive separately — a platform
 * constant, a plan grant, a tenant override. Two unrelated defects have
 * produced a `NaN` limit at that comparison:
 *
 * - `Number(undefined)` where a fallback was missing, and
 * - a proto loader configured with `defaults: false`, three layers from any
 *   code that mentions a file size (`loader-defaults.spec.ts`).
 *
 * Both end the same way. `value > NaN` is FALSE, so nothing is ever over the
 * limit: the check does not throw, does not clamp, and silently stops
 * rejecting anything. Guarding each route means finding every route; guarding
 * the comparison means the failure cannot reach a caller no matter which route
 * produced it.
 *
 * @param value The measured size, in the same unit as `limit`.
 * @param limit The resolved ceiling.
 * @returns `true` when `value` is over `limit`.
 * @throws Error when `limit` is not a finite, non-negative number — a state no
 * input can produce and only a defect can.
 *
 * @example
 * if (exceedsLimit(request.sizeBytes, limitBytes)) {
 *   throw new BadRequestException('File too large');
 * }
 */
export function exceedsLimit(value: number, limit: number): boolean {
  // `Number.isFinite` and not `!isNaN`: Infinity is equally unusable as a
  // ceiling and equally impossible to arrive at honestly. A negative limit
  // would reject everything, which is loud rather than dangerous — it is
  // refused here anyway because it can only mean the composition went wrong.
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error(
      `Refusing to compare against an unusable limit: ${String(limit)}`,
    );
  }

  return value > limit;
}
