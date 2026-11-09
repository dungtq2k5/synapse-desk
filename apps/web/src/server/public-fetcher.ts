import 'server-only';
import { readResponse, type Fetcher } from '@synapsedesk/api-client';

/**
 * The web server's own call to a public route: nothing of the visitor's goes
 * with it (no cookie, no address, no user agent), and the answer is cached
 * for `revalidate` seconds across every visitor: the rule for a public read.
 * `serverFetcher` carries the visitor's cookies and is never cached.
 *
 * A failed answer throws (`readResponse`), so it reaches the page as an error
 * and is retried on the next render rather than kept.
 *
 * @example await publicPlansControllerListPublicPlansV1({ fetcher: publicFetcher(300) })
 */
export function publicFetcher(revalidate: number): Fetcher {
  return async <T>(url: string, init: RequestInit): Promise<T> => {
    const gateway = process.env.GATEWAY_URL;
    if (!gateway) throw new Error('GATEWAY_URL is not set');

    const response = await fetch(`${gateway}${url}`, {
      method: init.method,
      headers: { accept: 'application/json' },
      next: { revalidate },
    });
    return readResponse<T>(response);
  };
}
