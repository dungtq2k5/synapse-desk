/**
 * @file The client a row uses: `fetch`, a cookie jar, and the raw response.
 *
 * Shaped after `test/system/client.ts`, with one difference that matters here:
 * every row asserts the WHOLE envelope and the headers, so `request` returns
 * the status, the parsed body **and** the headers rather than a convenience
 * shape. A harness that hid `set-cookie` could not pin a cookie's `Max-Age`,
 * which is one of the rows `auth.contract-spec.ts` asserts by name.
 *
 * Cookies rather than a bearer token, because that is what the product does.
 */

import { GATEWAY_ENV } from './gateway';

export type ContractResponse<T = unknown> = {
  status: number;
  headers: Headers;
  /** Every `set-cookie` line, unparsed — the flags are the assertion. */
  setCookie: string[];
  body: T;
  text: string;
};

/**
 * One `Set-Cookie` line, split into what a row actually asserts.
 *
 * Attribute keys are lowercased (`SameSite` vs `samesite` is not a contract a
 * client cares about); a bare flag (`HttpOnly`, `Secure`) maps to `true`. A
 * line with no `=` in its first segment returns `null` rather than a cookie
 * with an empty name — a malformed line must not silently parse into
 * something a row can pass against.
 */
export function parseSetCookie(line: string): {
  name: string;
  value: string;
  attributes: Record<string, string | true>;
} | null {
  const [pair, ...rest] = line.split(';');
  const at = pair.indexOf('=');
  if (at <= 0) return null;

  const attributes: Record<string, string | true> = {};
  for (const part of rest) {
    const [key, ...valueParts] = part.split('=');
    const name = key.trim().toLowerCase();
    if (!name) continue;
    attributes[name] = valueParts.length ? valueParts.join('=').trim() : true;
  }

  return {
    name: pair.slice(0, at).trim(),
    value: pair.slice(at + 1).trim(),
    attributes,
  };
}

/**
 * `/api/v1` — the prefix from the same `.env.test` the gateway is started with,
 * and the version the gateway pins.
 *
 * Built here rather than imported: `apiBasePath` lives in the gateway's own
 * `ops-routes.ts`, and a harness that reached into `apps/api-gateway/src` for
 * it would be reading the implementation it is supposed to treat as a black
 * box — and could not do it at all for the Java one. `API_VERSION` is a
 * constant of the contract, so a bump is a deliberate edit in both places, and
 * the ops rows below assert the unprefixed routes that prove the split.
 */
export const API = `/${(GATEWAY_ENV.GLOBAL_PREFIX ?? 'api').replace(/^\//u, '')}/v1`;

/** One browser-like session: it keeps the cookies it is given. */
export class Session {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  /** The cookie jar's current value for a name, for a row that asserts one. */
  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  async request<T = unknown>(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ContractResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.cookieHeader(),
        ...(init.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const setCookie = response.headers.getSetCookie();
    this.absorb(setCookie);

    const text = await response.text();

    return {
      status: response.status,
      headers: response.headers,
      setCookie,
      text,
      body: (text ? JSON.parse(text) : undefined) as T,
    };
  }

  get<T = unknown>(path: string, headers?: Record<string, string>) {
    return this.request<T>('GET', path, { headers });
  }

  post<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) {
    return this.request<T>('POST', path, { body, headers });
  }

  private cookieHeader(): Record<string, string> {
    if (this.cookies.size === 0) return {};

    return {
      cookie: [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    };
  }

  private absorb(setCookie: string[]): void {
    for (const raw of setCookie) {
      const [pair] = raw.split(';');
      const at = pair.indexOf('=');
      if (at <= 0) continue;

      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();

      // An expired cookie is a logout: dropping it is what makes the next
      // request actually unauthenticated.
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}
