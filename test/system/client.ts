/**
 * @file The gateway, over real HTTP.
 *
 * **No supertest and no `app.getHttpServer()`.** Both bind an in-process
 * application, which is exactly what every existing e2e suite already does and
 * exactly what this harness exists not to do. A `fetch` at
 * `http://localhost:3000` is the only client that proves a separate process is
 * answering.
 */

import { API, GATEWAY_URL } from './services';

/** What the envelope interceptor wraps every response in. */
type Envelope<T> = { data: T; message?: string };

export type Response<T> = {
  status: number;
  body: Envelope<T> & { message?: string };
};

/**
 * One session, holding its cookies.
 *
 * **Cookies rather than a bearer token**, because that is what the product
 * does: the access token is `HttpOnly`, which is also why CORS carries
 * `credentials: true`. A harness that authenticated with a header would be
 * exercising the fallback path rather than the one a browser takes.
 */
export class Session {
  // `readonly` on `cookies` and NOT on `lastSetCookie`, and the asymmetry is
  // the point: the map is mutated and never reassigned, the array is reassigned
  // per response. The analyser flagged both as one finding; acting on it
  // wholesale would not compile.
  private readonly cookies = new Map<string, string>();

  /** The last response's raw `set-cookie`, for a test that asserts on flags. */
  lastSetCookie: string[] = [];

  private header(): Record<string, string> {
    if (this.cookies.size === 0) return {};

    return {
      cookie: [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    };
  }

  private absorb(response: globalThis.Response): void {
    this.lastSetCookie = response.headers.getSetCookie?.() ?? [];

    for (const raw of this.lastSetCookie) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index <= 0) continue;

      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();

      // An expired cookie is a logout. Dropping it rather than storing the
      // empty value is what makes a later request actually unauthenticated.
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response<T>> {
    const response = await fetch(`${GATEWAY_URL}${API}${path}`, {
      method,
      headers: {
        ...this.header(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        // The front end sets it and the allow-list carries it; sending it here
        // keeps the harness on the same preflight the browser gets.
        'x-requested-with': 'XMLHttpRequest',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    this.absorb(response);

    const text = await response.text();
    const parsed = text
      ? (JSON.parse(text) as Envelope<T>)
      : ({} as Envelope<T>);

    return { status: response.status, body: parsed };
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
}

/**
 * A request with no session at all.
 *
 * Used by the smoke test, which must not authenticate: it has to be safe to
 * point at a real deployment, and creating a session there is a write.
 */
export async function anonymous<T>(path: string): Promise<Response<T>> {
  return new Session().get<T>(path);
}

/**
 * The ops routes, which sit OUTSIDE the global prefix.
 *
 * `OPS_ROUTES` is excluded from `setGlobalPrefix`, so `/health/ready` is not
 * `/api/v1/health/ready`. Getting this wrong produces a smoke test that reports
 * the deployment down when it is up.
 */
/**
 * Asserts a 2xx and returns the payload, quoting the API's own message when it
 * is not.
 *
 * **Because a bare `expect(status).toBe(201)` is a bad afternoon here.** Every
 * failure in this harness costs a two-minute stack restart to reproduce, and
 * `Expected 201, received 400` says nothing about which of a dozen rules
 * refused. The gateway already puts the reason in the envelope; this is what
 * gets it into the failure.
 */
export function expectOk<T>(response: Response<T>, what: string): T {
  if (response.status >= 200 && response.status < 300)
    return response.body.data;

  throw new Error(
    `${what} failed with ${response.status}: ${JSON.stringify(response.body)}`,
  );
}

export async function ops(
  path: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${GATEWAY_URL}${path}`);

  return { status: response.status, body: await response.text() };
}
