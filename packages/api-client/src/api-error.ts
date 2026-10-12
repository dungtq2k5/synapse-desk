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
  ) {
    super(ApiError.messageOf(status, body));
    this.name = 'ApiError';
  }

  private static messageOf(status: number, body: unknown): string {
    if (body && typeof body === 'object' && 'message' in body) {
      const message = body.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('\n');
    }
    return `HTTP ${status}`;
  }
}
