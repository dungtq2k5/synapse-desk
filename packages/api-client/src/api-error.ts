/**
 * A gateway answer that wasn't a 2xx, with the gateway's envelope as it came.
 * No message is rewritten on the way: the gateway already decides what a
 * client may see.
 *
 * @example
 * if (error instanceof ApiError && error.status === 404) showNotFound();
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The parsed response body: the gateway's error envelope, or `null`. */
    readonly body: unknown,
    /** A 429's `Retry-After`, in seconds; `null` when it wasn't sent. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(ApiError.messageOf(status, body));
    this.name = 'ApiError';
  }

  /**
   * The envelope's `details`: data for the refusals a client acts on, or null
   * on every other error.
   */
  get details(): Record<string, unknown> | null {
    const body = this.body as { details?: unknown } | null;
    const details = body && typeof body === 'object' ? body.details : null;
    return details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : null;
  }

  /**
   * The organization's status a lifecycle refusal names (`SUSPENDED_PAST_DUE`,
   * `FROZEN`), or null for any other error. Read instead of the sentence.
   */
  get organizationStatus(): string | null {
    const status = this.details?.organizationStatus;
    return typeof status === 'string' ? status : null;
  }

  /** The limits a plan that doesn't fit breaks; empty for any other error. */
  get overLimit(): OverLimit[] {
    const items = this.details?.overLimit;
    return Array.isArray(items) ? (items as OverLimit[]) : [];
  }

  private static messageOf(status: number, body: unknown): string {
    // Both gateways put the words in `error` (`{ success, statusCode, path,
    // timestamp, error }`); `message` is what a non-gateway body may carry.
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
    if (body && typeof body === 'object' && 'message' in body) {
      const message = body.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('\n');
    }
    return `HTTP ${status}`;
  }
}

/** One limit a plan would break, as `details.overLimit` carries it. */
export type OverLimit = {
  dimension: 'SEATS' | 'STORAGE' | 'DOCUMENTS';
  inUse: number;
  allowed: number;
};
