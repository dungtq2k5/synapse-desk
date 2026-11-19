/**
 * The fail-open lines a row stages on purpose (an outage it simulates):
 * declared with {@link allowFailOpen}, the guard in `fail-open.setup.ts` lets
 * those through for that row only.
 */
const declared: string[] = [];

/**
 * Lets these fail-open lines through for the running row: each is the start
 * of the message, as in `FAIL_OPEN_LINES`.
 *
 * @example allowFailOpen('Rate-limit storage unavailable')
 */
export function allowFailOpen(...lines: string[]): void {
  declared.push(...lines);
}

/** What the running row declared. */
export function declaredFailOpen(): readonly string[] {
  return declared;
}

/** Forgets the last row's declarations. */
export function resetFailOpen(): void {
  declared.length = 0;
}
