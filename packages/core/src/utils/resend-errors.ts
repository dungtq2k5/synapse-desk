/**
 * The two fields of a Resend SDK error this repository decides on.
 *
 * Structural rather than imported from `resend`, so the library carries no
 * dependency on the SDK its services use.
 */
export type ResendErrorLike = {
  name: string;
  statusCode: number | null;
};

/**
 * Whether a Resend API error is worth trying again — the one rule both
 * directions use: notification-service redelivers a send, the gateway answers
 * a webhook `503` so Resend redelivers it.
 *
 * **By status code, not by error name.** The name is ambiguous both ways in the
 * SDK: `application_error` is also what ANY non-JSON error body becomes, a
 * proxy's 403 page included, while `statusCode: null` is mostly the SDK's own
 * argument checks (`missing_required_field`, `invalid_parameter`) and only once
 * a `fetch` that never reached Resend. So a null status is retryable only as
 * that network failure, and a numeric one only as 429 or 5xx.
 *
 * `concurrent_idempotent_requests` is the one name that decides on its own: the
 * same idempotency key is still in flight, and waiting is the answer.
 *
 * @example isRetryableResendError({ name: 'rate_limit_exceeded', statusCode: 429 }) // true
 * @example isRetryableResendError({ name: 'missing_required_field', statusCode: null }) // false
 */
export function isRetryableResendError(error: ResendErrorLike): boolean {
  if (error.name === 'concurrent_idempotent_requests') return true;

  return error.statusCode === null
    ? error.name === 'application_error'
    : error.statusCode === 429 || error.statusCode >= 500;
}
