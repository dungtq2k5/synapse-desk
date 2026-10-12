import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import { connect } from 'node:net';

/** Where the browser goes: one origin, as in the cluster. */
export const INGRESS_PORT = 5173;
export const WEB_URL = `http://localhost:${INGRESS_PORT}`;

/** The built web app (`next start`), behind the ingress. */
export const WEB_PORT = 5174;
const GATEWAY_PORT = 3000;
const REALTIME_PORT = 3001;

/**
 * The cluster's Ingress split in miniature (`k8s/ingress.yaml`): `/api` and
 * `/graphql` to the gateway's HTTP port, `/socket.io` (with its upgrade) to
 * its realtime port, everything else to the web app. Like ingress-nginx, it
 * appends the caller's address to `X-Forwarded-For`, so the gateway sees the
 * same header shape it sees in production.
 *
 * In-process rather than a second binary: it lives exactly as long as the run.
 */
export function startIngress(): Promise<Server> {
  const server = createServer((incoming, outgoing) => {
    const upstream = request(
      {
        host: '127.0.0.1',
        port: portFor(incoming.url ?? '/'),
        method: incoming.method,
        path: incoming.url,
        headers: forwarded(incoming),
      },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.writeHead(502).end());
    incoming.pipe(upstream);
  });

  server.on('upgrade', (incoming: IncomingMessage, socket, head: Buffer) => {
    const upstream = connect(portFor(incoming.url ?? '/'), '127.0.0.1', () => {
      const headers = Object.entries(forwarded(incoming)).flatMap(
        ([name, value]) =>
          (Array.isArray(value) ? value : [value]).map(
            (one) => `${name}: ${one}`,
          ),
      );
      upstream.write(
        [
          `${incoming.method} ${incoming.url} HTTP/1.1`,
          ...headers,
          '',
          '',
        ].join('\r\n'),
      );
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return new Promise((resolve) =>
    server.listen(INGRESS_PORT, () => resolve(server)),
  );
}

function portFor(path: string): number {
  if (path.startsWith('/api/') || path.startsWith('/graphql')) {
    return GATEWAY_PORT;
  }
  if (path.startsWith('/socket.io')) return REALTIME_PORT;
  return WEB_PORT;
}

function forwarded(incoming: IncomingMessage): IncomingHttpHeaders {
  const peer = incoming.socket.remoteAddress ?? '127.0.0.1';
  const prior = incoming.headers['x-forwarded-for'];
  return {
    ...incoming.headers,
    'x-forwarded-for': prior ? `${String(prior)}, ${peer}` : peer,
  };
}
