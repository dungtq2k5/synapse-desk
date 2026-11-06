import { OFFLINE_PAGE } from './page';

/** The origin's answers that mean the demo's machine, or a container, is down. */
const DOWN = new Set([502, 503, 504, 530]);

/**
 * Whether a request is a page load: a `GET` whose `Accept` asks for HTML,
 * outside the API, GraphQL and the socket. Only those get the offline page;
 * everything else keeps the origin's own error, so Stripe and Resend see a
 * failure and retry, and the web's error handling sees the status.
 */
export function isPageLoad(request: Request): boolean {
  if (request.method !== 'GET') return false;
  if (!(request.headers.get('accept') ?? '').includes('text/html')) {
    return false;
  }
  const { pathname } = new URL(request.url);
  return !/^\/(api|graphql)(\/|$)|^\/socket\.io\//.test(pathname);
}

/** The offline page, as a 503 the visitor's browser and crawlers both read right. */
export function offlineResponse(): Response {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'retry-after': '300',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Passes the request to the origin unchanged, and answers a page load with
 * the offline page when the origin is down: the fetch throws, or it answers
 * 502, 503, 504 or 530.
 *
 * @example await handle(request, () => fetch(request))
 */
export async function handle(
  request: Request,
  origin: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!isPageLoad(request)) return origin(request);
  try {
    const response = await origin(request);
    return DOWN.has(response.status) ? offlineResponse() : response;
  } catch {
    return offlineResponse();
  }
}

export default {
  fetch: (request: Request): Promise<Response> =>
    handle(request, (forward) => fetch(forward)),
};
