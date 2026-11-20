import { ApiError } from './api-error';

/**
 * A response's body: parsed JSON for a 2xx (or `undefined` when there is
 * none), else `ApiError` carrying the status and the parsed envelope. Shared by
 * both fetchers, so they read an answer the same way.
 *
 * @example
 * return readResponse<T>(await fetch(url, init));
 */
export async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body ?? null,
      retryAfterSeconds(response.headers.get('retry-after')),
    );
  }
  return body as T;
}

/** `Retry-After` in its delta-seconds form; an HTTP date or junk is `null`. */
function retryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}
