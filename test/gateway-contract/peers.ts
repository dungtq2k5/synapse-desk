/**
 * @file The peers, as real gRPC SERVERS.
 *
 * This is what `overrideProvider(AUTH_GRPC_CLIENT)` becomes when the thing
 * under test is a process: a server on a port the gateway is told to dial,
 * built from the same `.proto` files the gateway loads, so a proto change
 * reaches both sides at once.
 *
 * **Every method of every service is implemented**, and an unprogrammed one
 * fails with `UNIMPLEMENTED` naming itself. A peer that hung instead would
 * turn a missing `reply(…)` into a row that times out sixty seconds later
 * pointing at nothing.
 *
 * **No control channel.** The servers run inside the jest worker, so a row
 * programs them by calling a method rather than over a socket; the gateway
 * still reaches them only over the wire, which is the property that matters.
 * A channel becomes necessary only if these ever move out of the test process.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Server,
  ServerCredentials,
  type ServerUnaryCall,
  type ServerWritableStream,
  type sendUnaryData,
  loadPackageDefinition,
  status as GrpcStatus,
} from '@grpc/grpc-js';
import { loadSync, type PackageDefinition } from '@grpc/proto-loader';
import {
  AUTH_PROTO_PATHS,
  GRPC_LOADER_OPTIONS,
  INGESTION_PROTO_PATHS,
  NOTIFICATION_PROTO_PATHS,
  RAG_PROTO_PATHS,
  TICKET_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';

/** One recorded call: what arrived, and the caller context that came with it. */
export type Recorded = {
  method: string;
  request: Record<string, unknown>;
  /** Every metadata key as a string — the eight `GRPC_CONTEXT_METADATA` ones. */
  metadata: Record<string, string>;
};

type Programmed =
  | { kind: 'reply'; value: unknown }
  | { kind: 'fail'; code: GrpcStatus; details: string }
  | {
      kind: 'stream';
      chunks: unknown[];
      failWith?: { code: GrpcStatus; details: string };
    };

/** What a row calls to say what a method does next. */
export type Program = {
  /** The next call to this method answers with `value`. */
  reply: (value: unknown) => void;
  /** …and every call after that, until reprogrammed. */
  always: (value: unknown) => void;
  fail: (code: GrpcStatus, details: string) => void;
  /** A server stream: these chunks, then completion — or `failWith`. */
  stream: (
    chunks: unknown[],
    failWith?: { code: GrpcStatus; details: string },
  ) => void;
};

export class FakePeer {
  private readonly server = new Server();
  private readonly queued = new Map<string, Programmed[]>();
  private readonly standing = new Map<string, Programmed>();
  private readonly recorded: Recorded[] = [];

  /** `127.0.0.1:<port>`, which is what the gateway's `*_SERVICE_URL` takes. */
  address = '';

  constructor(
    readonly name: string,
    private readonly protoPaths: string[],
  ) {}

  async start(): Promise<void> {
    const definition = loadSync(this.protoPaths, GRPC_LOADER_OPTIONS);
    this.addEveryService(definition);

    const port = await new Promise<number>((resolve, reject) => {
      this.server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (error, bound) => (error ? reject(error) : resolve(bound)),
      );
    });

    this.address = `127.0.0.1:${port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.tryShutdown(() => resolve()));
  }

  /** `peers.auth.on('UserService/GetUser').reply({ … })`. */
  on(method: string): Program {
    const queue = () => {
      const existing = this.queued.get(method) ?? [];
      this.queued.set(method, existing);

      return existing;
    };

    return {
      reply: (value) => queue().push({ kind: 'reply', value }),
      always: (value) => this.standing.set(method, { kind: 'reply', value }),
      fail: (code, details) => queue().push({ kind: 'fail', code, details }),
      stream: (chunks, failWith) =>
        queue().push({ kind: 'stream', chunks, failWith }),
    };
  }

  /** Every call to a method, in order — request and metadata. */
  calls(method?: string): Recorded[] {
    return method === undefined
      ? [...this.recorded]
      : this.recorded.filter((call) => call.method === method);
  }

  /** Forgets recordings and one-shot programming; standing replies survive. */
  reset(): void {
    this.recorded.length = 0;
    this.queued.clear();
  }

  private next(method: string): Programmed | undefined {
    return this.queued.get(method)?.shift() ?? this.standing.get(method);
  }

  private addEveryService(definition: PackageDefinition): void {
    const loaded = loadPackageDefinition(definition) as Record<string, unknown>;

    for (const [name, service] of servicesIn(loaded)) {
      const handlers: Record<string, unknown> = {};

      for (const [rpc, spec] of Object.entries(
        service as Record<string, { responseStream?: boolean }>,
      )) {
        const method = `${name}/${rpc[0].toUpperCase()}${rpc.slice(1)}`;
        handlers[rpc] = spec.responseStream
          ? this.streamHandler(method)
          : this.unaryHandler(method);
      }

      this.server.addService(
        service as Parameters<Server['addService']>[0],
        handlers as Parameters<Server['addService']>[1],
      );
    }
  }

  private record(
    method: string,
    call: {
      request: unknown;
      metadata: { getMap: () => Record<string, unknown> };
    },
  ): void {
    this.recorded.push({
      method,
      request: call.request as Record<string, unknown>,
      metadata: Object.fromEntries(
        Object.entries(call.metadata.getMap()).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
    });
  }

  private unaryHandler(method: string) {
    return (
      call: ServerUnaryCall<unknown, unknown>,
      callback: sendUnaryData<unknown>,
    ): void => {
      this.record(method, call);
      const programmed = this.next(method);

      if (programmed === undefined) {
        callback(unprogrammed(this.name, method));

        return;
      }
      if (programmed.kind === 'fail') {
        callback({ code: programmed.code, details: programmed.details });

        return;
      }
      if (programmed.kind === 'stream') {
        callback(unprogrammed(this.name, `${method} (stream on a unary call)`));

        return;
      }

      callback(null, programmed.value);
    };
  }

  private streamHandler(method: string) {
    return (call: ServerWritableStream<unknown, unknown>): void => {
      this.record(method, call);
      const programmed = this.next(method);

      if (programmed?.kind !== 'stream') {
        call.destroy(unprogrammed(this.name, method) as unknown as Error);

        return;
      }

      for (const chunk of programmed.chunks) call.write(chunk);
      if (programmed.failWith) {
        call.destroy({
          code: programmed.failWith.code,
          details: programmed.failWith.details,
        } as unknown as Error);

        return;
      }

      call.end();
    };
  }
}

function unprogrammed(peer: string, method: string) {
  return {
    code: GrpcStatus.UNIMPLEMENTED,
    details:
      `The ${peer} fake peer has no programmed answer for ${method}. ` +
      `A row says what it returns: peers.${peer}.on('${method}').reply(…).`,
  };
}

/** Every `{ ServiceName, definition }` in a loaded package, at any depth. */
function servicesIn(
  node: Record<string, unknown>,
  found: [string, object][] = [],
): [string, object][] {
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'function' && 'service' in value) {
      found.push([key, (value as { service: object }).service]);
    } else if (value && typeof value === 'object') {
      servicesIn(value as Record<string, unknown>, found);
    }
  }

  return found;
}

export type Peers = {
  auth: FakePeer;
  ticket: FakePeer;
  ingestion: FakePeer;
  rag: FakePeer;
  notification: FakePeer;
  /** The `*_SERVICE_URL` environment the gateway is started with. */
  env: Record<string, string>;
  stop: () => Promise<void>;
  reset: () => void;
};

/** Starts one server per peer the gateway dials. */
export async function startPeers(): Promise<Peers> {
  const peers = {
    auth: new FakePeer('auth', AUTH_PROTO_PATHS),
    ticket: new FakePeer('ticket', TICKET_PROTO_PATHS),
    ingestion: new FakePeer('ingestion', INGESTION_PROTO_PATHS),
    rag: new FakePeer('rag', RAG_PROTO_PATHS),
    notification: new FakePeer('notification', NOTIFICATION_PROTO_PATHS),
  };

  await Promise.all(Object.values(peers).map((peer) => peer.start()));

  return {
    ...peers,
    env: {
      AUTH_SERVICE_URL: peers.auth.address,
      TICKET_SERVICE_URL: peers.ticket.address,
      INGESTION_SERVICE_URL: peers.ingestion.address,
      RAG_SERVICE_URL: peers.rag.address,
      NOTIFICATION_SERVICE_URL: peers.notification.address,
    },
    stop: async () => {
      await Promise.all(Object.values(peers).map((peer) => peer.stop()));
    },
    reset: () => {
      for (const peer of Object.values(peers)) peer.reset();
    },
  };
}

/** The tracked test keys, read as data — the harness never imports gateway code. */
export const TEST_KEYS = {
  access: () => key('jwt-access.test.key'),
  twoFactor: () => key('jwt-2fa.test.key'),
};

function key(file: string): string {
  return readFileSync(
    join(__dirname, '../../apps/api-gateway/test/fixtures/keys', file),
    'utf8',
  );
}
