import type { ApiError } from './api-error';
import { browserFetch } from './browser-fetcher';

/** Sends one request and returns its parsed 2xx body, or throws `ApiError`. */
export type Fetcher = <T>(url: string, init: RequestInit) => Promise<T>;

/**
 * A request's options: `fetch`'s own, plus the fetcher to send it with. The
 * browser fetcher is the default; the web server's renderer passes its own,
 * per call, so no state is shared between requests.
 */
export type RequestOptions = RequestInit & { fetcher?: Fetcher };

/**
 * The one mutator every generated call goes through.
 *
 * @example
 * ticketsControllerListV1(params, { fetcher: serverFetcher });
 */
export const customFetch = <T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> => {
  const { fetcher = browserFetch, ...init } = options;
  return fetcher<T>(url, init);
};

/**
 * What a generated call throws: `ApiError`, its `body` typed as the error
 * envelope the document declares for that status. Orval reads this name.
 */
export type ErrorType<Body> = ApiError & { body: Body };
