import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/** What one route answers; a handler may write anything it likes instead. */
export type SourceRoute =
  | {
      status?: number;
      headers?: Record<string, string>;
      body?: Buffer | string;
    }
  | ((request: IncomingMessage, response: ServerResponse) => void);

/**
 * A local HTTPS server that plays an attachment source.
 *
 * A REAL server with a checked-in self-signed certificate — the same pair
 * notification-service's webhook receiver uses — reached through the ingest
 * hatch, so the fetcher's whole path (guarded lookup, TLS, redirects, streaming)
 * runs rather than a stub of it. `requests` records every path that arrived,
 * which is how a test proves a refusal happened BEFORE any socket.
 */
export type SourceServer = {
  /** `https://localhost:<port><path>`. */
  url: (path: string) => string;
  port: number;
  /** Paths requested so far, in order. */
  requests: string[];
  /** Serves `path`; replaces any previous route for it. */
  route: (path: string, route: SourceRoute) => void;
  reset: () => void;
  close: () => Promise<void>;
};

export async function startSourceServer(): Promise<SourceServer> {
  const routes = new Map<string, SourceRoute>();
  const requests: string[] = [];

  const server: Server = createServer(
    {
      key: readFileSync(join(__dirname, '../fixtures/receiver-key.pem')),
      cert: readFileSync(join(__dirname, '../fixtures/receiver-cert.pem')),
    },
    (request, response) => {
      const path = request.url ?? '/';
      requests.push(path);
      const route = routes.get(path);

      if (!route) {
        response.writeHead(404).end();
        return;
      }
      if (typeof route === 'function') {
        route(request, response);
        return;
      }

      response.writeHead(route.status ?? 200, route.headers ?? {});
      response.end(route.body ?? '');
    },
  );

  // No host: dual-stack, because the fetcher pins to the FIRST address the
  // resolver returns and `localhost` may resolve to ::1 first.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: (path) => `https://localhost:${port}${path}`,
    port,
    requests,
    route: (path, route) => routes.set(path, route),
    reset: () => {
      routes.clear();
      requests.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
