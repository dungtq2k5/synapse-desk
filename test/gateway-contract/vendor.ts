/**
 * @file A third party's HTTP API, as a real HTTP SERVER.
 *
 * `peers.ts` fakes the gRPC services the gateway calls; nothing faked an HTTP
 * vendor, which is why everything past the Resend signature boundary could not
 * be tested: the gateway fetches the mail it was told about from Resend's
 * production API, and a row cannot program that. This is the same idea for a
 * vendor — a server on a port the gateway is told to call, programmed by the
 * row, reached only over the wire.
 *
 * **The seam is the vendor's base URL**, which the gateway takes from an
 * environment variable (`RESEND_BASE_URL` for the stock Resend SDK, which reads
 * it itself). No code in the gateway knows it is talking to a fake.
 *
 * **An unprogrammed route fails loudly and is recorded.** It answers `501`
 * naming itself rather than a status a gateway might act on (`404` reads as
 * "that mail does not exist"), and {@link FakeVendor.unprogrammed} lists it so a
 * spec can assert nothing reached one by accident.
 *
 * **A dropped connection is a first-class shape.** It is how a vendor that never
 * answered looks to a client — the case the Resend SDK reports with a null
 * status, which a gateway must treat as retryable and not as a verdict on the
 * mail.
 */

import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/** One recorded request: what arrived, and the credential that came with it. */
export type RecordedRequest = {
  method: string;
  /** The path without its query string. */
  path: string;
  /** The raw query string, without the leading `?`; empty when there is none. */
  query: string;
  /** Header names are lowercased by Node. */
  headers: IncomingHttpHeaders;
};

type Programmed =
  | { kind: 'reply'; status: number; body: string; contentType: string }
  | { kind: 'drop' };

/** What a row calls to say what a route does next. */
export type VendorProgram = {
  /** The next request to this route answers `status` with `body` as JSON. */
  reply: (status: number, body?: unknown) => void;
  /** …and every request after that, until reprogrammed. */
  always: (status: number, body?: unknown) => void;
  /**
   * The next request is answered with raw text rather than JSON — a vendor's
   * error page, or a proxy's, which a client must not be able to mistake for the
   * vendor's own error shape.
   */
  replyRaw: (status: number, text: string, contentType?: string) => void;
  /** The next request's connection is destroyed with no response at all. */
  dropConnection: () => void;
};

/**
 * An error body carries its own status, as the real API's does.
 *
 * **Not decoration.** The stock Resend SDK takes a JSON error body AS the error
 * and never looks at the HTTP status, so a body without `statusCode` classifies
 * as "no status" — different from the real API for the same answer. Filling it
 * in keeps the fake answering as the real API does.
 */
const withStatus = (status: number, body: unknown): unknown =>
  status >= 400 &&
  typeof body === 'object' &&
  body !== null &&
  !Array.isArray(body) &&
  !('statusCode' in body)
    ? { statusCode: status, ...body }
    : body;

const routeKey = (method: string, path: string): string =>
  `${method.toUpperCase()} ${path}`;

export class FakeVendor {
  private readonly server: Server;
  private readonly queued = new Map<string, Programmed[]>();
  private readonly standing = new Map<string, Programmed>();
  private readonly recorded: RecordedRequest[] = [];
  private readonly missed: string[] = [];

  /** `http://127.0.0.1:<port>`, which is what the gateway's base-URL variable takes. */
  baseUrl = '';

  constructor(readonly name: string) {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });

    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();

    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** `vendor.on('GET', '/emails/receiving/abc').reply(200, { … })`. */
  on(method: string, path: string): VendorProgram {
    const key = routeKey(method, path);
    const queue = (): Programmed[] => {
      const existing = this.queued.get(key) ?? [];
      this.queued.set(key, existing);

      return existing;
    };
    const json = (
      status: number,
      body: unknown,
    ): Extract<Programmed, { kind: 'reply' }> => ({
      kind: 'reply',
      status,
      body: body === undefined ? '' : JSON.stringify(withStatus(status, body)),
      contentType: 'application/json',
    });

    return {
      reply: (status, body) => queue().push(json(status, body)),
      always: (status, body) => this.standing.set(key, json(status, body)),
      replyRaw: (status, text, contentType = 'text/html') =>
        queue().push({ kind: 'reply', status, body: text, contentType }),
      dropConnection: () => queue().push({ kind: 'drop' }),
    };
  }

  /** Every request, in order — optionally only those to one path. */
  calls(path?: string): RecordedRequest[] {
    return path === undefined
      ? [...this.recorded]
      : this.recorded.filter((call) => call.path === path);
  }

  /** The routes that were requested with nothing programmed for them. */
  unprogrammed(): string[] {
    return [...this.missed];
  }

  /** Forgets recordings and one-shot programming; standing replies survive. */
  reset(): void {
    this.recorded.length = 0;
    this.missed.length = 0;
    this.queued.clear();
  }

  /** The environment a gateway needs to call this vendor instead of the real one. */
  envFor(variable: string): Record<string, string> {
    return { [variable]: this.baseUrl };
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const method = req.method ?? 'GET';
    const [path, query = ''] = (req.url ?? '/').split('?');

    this.recorded.push({ method, path, query, headers: req.headers });

    const key = routeKey(method, path);
    const next = this.queued.get(key)?.shift() ?? this.standing.get(key);

    if (next === undefined) {
      this.missed.push(key);
      res.writeHead(501, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          statusCode: 501,
          name: 'not_programmed',
          message: `${this.name}: ${key} was not programmed`,
        }),
      );

      return;
    }

    if (next.kind === 'drop') {
      req.socket.destroy();

      return;
    }

    res.writeHead(next.status, { 'content-type': next.contentType });
    res.end(next.body);
  }
}
