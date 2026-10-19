/**
 * The envelope every successful REST response is wrapped in by
 * `TransformInterceptor`. Handlers return raw data and never build this
 * themselves.
 */
export interface SuccessResponse<T = unknown> {
  success: true;
  statusCode: number;
  message: string;
  warning: string | null;
  data: T;
}

/** The single error shape every REST route returns, whatever threw. */
export interface ErrorResponse {
  success: false;
  statusCode: number;
  path: string;
  timestamp: string;
  error: string;
  /**
   * Data for the refusals a client acts on: `overLimit` on a plan that doesn't
   * fit, `organizationStatus` on a lifecycle refusal. Absent on every other
   * error.
   */
  details?: Record<string, unknown>;
}
