import { isRetryableResendError } from './resend-errors';

/**
 * The retry rule, by status first. Each row is a case where deciding by NAME
 * gives the opposite answer, or where the status alone is not enough.
 */
describe('isRetryableResendError', () => {
  it.each([
    ['429 rate_limit_exceeded', 'rate_limit_exceeded', 429],
    ['500 internal_server_error', 'internal_server_error', 500],
    ['503 application_error — a non-JSON 5xx body', 'application_error', 503],
    ['null application_error — the fetch failure', 'application_error', null],
    [
      '409 concurrent_idempotent_requests',
      'concurrent_idempotent_requests',
      409,
    ],
  ])('%s → retry', (_, name, statusCode) => {
    expect(isRetryableResendError({ name, statusCode })).toBe(true);
  });

  it.each([
    ['403 application_error — a proxy page', 'application_error', 403],
    [
      'null missing_required_field — an SDK argument check',
      'missing_required_field',
      null,
    ],
    [
      'null invalid_parameter — an SDK argument check',
      'invalid_parameter',
      null,
    ],
    ['422 validation_error', 'validation_error', 422],
    ['401 restricted_api_key', 'restricted_api_key', 401],
    ['409 invalid_idempotent_request', 'invalid_idempotent_request', 409],
    ['404 not_found', 'not_found', 404],
  ])('%s → do not retry', (_, name, statusCode) => {
    expect(isRetryableResendError({ name, statusCode })).toBe(false);
  });
});
