/**
 * The gateway, faked at `fetch`: jsdom has none, and stubbing the network
 * rather than the generated client keeps the real fetcher, its envelope reading
 * and its `ApiError` in the test.
 *
 * Routes are `"METHOD /path"` (no query string). A reply is a body and an
 * optional status and headers, or a function of the request body (and its
 * URL, query and all) that returns one. An unstubbed call fails the test with its name.
 *
 * @example
 * const calls = stubApi({ 'POST /api/v1/auth/login': ok({ requiresTwoFactor: true }) });
 */
export type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};
type Route = Reply | ((body: unknown, url: string) => Reply);
export type Call = { method: string; url: string; body: unknown };

export function stubApi(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = jest.fn((input: string | URL, init: RequestInit = {}) => {
    const url = input.toString();
    const method = (init.method ?? 'GET').toUpperCase();
    const body =
      typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const route = routes[`${method} ${url.split('?')[0]}`];
    if (!route)
      return Promise.reject(new Error(`No stub for ${method} ${url}`));
    return Promise.resolve(
      response(typeof route === 'function' ? route(body, url) : route),
    );
  }) as typeof fetch;
  return calls;
}

/** The gateway's success envelope around `data`. */
export function ok(data: unknown, status = 200): Reply {
  return { status, body: { success: true, message: 'OK', data } };
}

/** The gateway's error envelope, its words in `error` as both gateways send them. */
export function fail(
  status: number,
  message: string,
  headers?: Record<string, string>,
): Reply {
  return {
    status,
    body: {
      success: false,
      statusCode: status,
      path: '/api/v1',
      timestamp: '2026-10-17T00:00:00.000Z',
      error: message,
    },
    headers,
  };
}

function response({ status = 200, body, headers }: Reply): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  const fake = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text) as unknown),
    clone: () => fake,
  };
  return fake as unknown as Response;
}
