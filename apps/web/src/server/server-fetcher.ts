import 'server-only';
import { readResponse, type Fetcher } from '@synapsedesk/api-client';
import { headers } from 'next/headers';

/**
 * The gateway refused the forwarded cookies: the access token expired or is
 * missing. A page treats it as "render without data"; the browser then fetches,
 * refreshes and retries itself.
 */
export class Unauthenticated extends Error {
  constructor() {
    super('The gateway answered 401 to a server-rendered call');
    this.name = 'Unauthenticated';
  }
}

/** Forwarded as they arrived, never parsed, never added to. */
const FORWARDED = ['cookie', 'user-agent', 'x-forwarded-for'] as const;

/**
 * The renderer's fetcher for one incoming request: the gateway's in-cluster
 * address, the browser's own cookies, and nothing cached.
 *
 * - **`cache: 'no-store'` on every call.** A cached answer to a call that
 *   carried one user's cookies would be served to the next user.
 * - **It never refreshes.** A 401 throws `Unauthenticated`; the refresh token
 *   is the browser's to use.
 * - **`X-Forwarded-For` is forwarded unchanged**, never appended to, so the
 *   gateway's rightmost entry is still the client's address.
 *
 * @example
 * await queryClient.prefetchQuery(
 *   getTicketsControllerListV1QueryOptions(params, { request: { fetcher: forRequest(incoming) } }),
 * );
 */
export function forRequest(incoming: Headers): Fetcher {
  return async <T>(url: string, init: RequestInit): Promise<T> => {
    const gateway = process.env.GATEWAY_URL;
    if (!gateway) throw new Error('GATEWAY_URL is not set');

    const outgoing = new Headers(init.headers);
    for (const name of FORWARDED) {
      const value = incoming.get(name);
      if (value !== null) outgoing.set(name, value);
    }

    const response = await fetch(`${gateway}${url}`, {
      ...init,
      headers: outgoing,
      cache: 'no-store',
    });
    if (response.status === 401) throw new Unauthenticated();

    return readResponse<T>(response);
  };
}

/** The fetcher for the request being rendered now. */
export async function serverFetcher(): Promise<Fetcher> {
  return forRequest(await headers());
}
