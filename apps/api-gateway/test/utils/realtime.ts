import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MicroserviceOptions,
  ClientProxy,
  ClientProxyFactory,
} from '@nestjs/microservices';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { io, Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'node:http';
import {
  createNatsTransport,
  JwtPayload,
  TicketDomainEvent,
} from '@synapsedesk/common';
import {
  AUTH_GRPC_CLIENT,
  RAG_GRPC_CLIENT,
  TICKET_GRPC_CLIENT,
} from '@synapsedesk/grpc-proto';
import { AppModule } from '../../src/app.module';
import { OPS_ROUTES } from '../../src/modules/health/ops-routes';
import { RedisIoAdapter } from '../../src/common/adapters/redis-io.adapter';
import { GrpcStubs, stubGrpcServices } from './grpc-stub';
import { ACCESS_COOKIE, buildJwtPayload } from './auth';
import { signAccessToken } from './tokens';

export type RealtimeFixture = {
  app: INestApplication<Server>;
  stubs: GrpcStubs;
  /** Where a client connects: `http://localhost:<ephemeral>/ws`. */
  wsUrl: string;
  /** Publishes a domain event exactly as ticket-service would. */
  publish: (event: TicketDomainEvent) => Promise<void>;
  /**
   * Publishes on an ARBITRARY subject — Domain E's `notification.*`.
   *
   * `publish` above takes a `TicketDomainEvent` and reads its own `pattern`,
   * which is right for Domain B and cannot express a payload that carries no
   * pattern field. Notification payloads do not: the subject IS the type.
   */
  publishOn: (pattern: string, payload: unknown) => Promise<void>;
  /** An authenticated, connected client. Tracked and closed by `close()`. */
  connectClient: (overrides?: Partial<JwtPayload>) => Promise<ClientSocket>;
  /** A client with a deliberately bad cookie, for the rejection cases. */
  connectRaw: (cookie: string) => ClientSocket;
  /**
   * A direct Redis handle, for the presence tests.
   *
   * Used to EXPIRE a key rather than to write one: the presence test asks what
   * happens to a user whose heartbeat stops with no disconnect, and the honest
   * way to ask that is to remove the key the way a TTL would — not to wait sixty
   * seconds, and not to call a method the production path never calls.
   */
  redis: Redis;
  close: () => Promise<void>;
};

/**
 * Boots the gateway with the real-time stack ACTUALLY LISTENING.
 *
 * Separate from `bootstrapE2eTest` because that one deliberately never binds a
 * port — supertest drives the HTTP stack in-process, and binding one per suite
 * would make the whole run slower and collision-prone. A WebSocket cannot be
 * driven in-process: it needs a real socket, so this fixture pays that cost and
 * only the suites that need it do.
 *
 * `listen(0)` asks the OS for any free ephemeral port. Hardcoding one works
 * until two suites run at once, or until CI already has something on it — and
 * the failure then is `EADDRINUSE` in a suite that has nothing to do with
 * ports.
 */
export async function bootstrapRealtimeTest(
  configure?: (builder: TestingModuleBuilder) => void,
): Promise<RealtimeFixture> {
  const { stubs, clientGrpc } = stubGrpcServices();

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUTH_GRPC_CLIENT)
    .useValue(clientGrpc)
    .overrideProvider(TICKET_GRPC_CLIENT)
    .useValue(clientGrpc)
    // Domain C's Python peer, for the AI streaming relay. Stubbed
    // like the others: what the gateway can prove alone is that it RELAYS a
    // server-stream correctly, which is a property of this process. Whether a
    // cancelled generation writes its ledger row is rag-service's half, and is
    // tested there (`tests/test_generation.py`).
    .overrideProvider(RAG_GRPC_CLIENT)
    .useValue(clientGrpc);

  configure?.(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const configService = app.get(ConfigService);

  app.set('trust proxy', 1);
  app.setGlobalPrefix(configService.getOrThrow<string>('GLOBAL_PREFIX'), {
    exclude: OPS_ROUTES,
  });
  app.use(cookieParser());

  // **The SAME global pipe `main.ts` installs**, and it matters more than it
  // looks. `useGlobalPipes` binds across every execution context, sockets
  // included — so a fixture without it runs the handlers under different rules
  // than production, and the difference only shows up the day someone types a
  // `@MessageBody()` as a DTO and the pipe starts rejecting frames the tests
  // never saw it reject.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // The SAME adapter main.ts installs. Using the default in-memory one here
  // would leave the Redis path — the part that only fails across replicas —
  // untested by every suite that uses this fixture.
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connect();
  app.useWebSocketAdapter(redisIoAdapter);

  app.connectMicroservice<MicroserviceOptions>(
    createNatsTransport(configService),
  );
  await app.startAllMicroservices();
  await app.listen(0);

  const address = app.getHttpServer().address();
  const port = typeof address === 'string' ? 0 : (address?.port ?? 0);
  const wsUrl = `http://127.0.0.1:${port}/ws`;

  /**
   * A real Nest `ClientProxy`, not a bare `nats.publish`.
   *
   * This matters more than it looks. Our domain events carry their own
   * `pattern` FIELD, and Nest's NATS deserializer decides whether a payload is
   * already an envelope by asking whether it has `pattern` or `data`. A raw
   * publish of a `TicketDomainEvent` therefore looks like an envelope, Nest
   * extracts its (absent) `.data`, and the handler receives `undefined` —
   * silently, because a NATS handler that throws is logged and dropped.
   *
   * ticket-service publishes through a ClientProxy, which nests the event under
   * `data` where it belongs. Publishing the same way here is what makes this
   * fixture exercise the production framing rather than a path nothing uses.
   */
  const natsClient: ClientProxy = ClientProxyFactory.create(
    createNatsTransport(configService),
  );
  await natsClient.connect();

  // Tracked so `close()` can force them shut. A socket left open keeps the
  // event loop alive and jest hangs after the last assertion passes — a failure
  // that looks like a timeout in whichever test happened to run last.
  const clients: ClientSocket[] = [];

  const publish = async (event: TicketDomainEvent): Promise<void> => {
    // `emit` returns a cold observable — nothing is sent until something
    // subscribes, which is the same trap `TicketEventPublisher` documents.
    await new Promise<void>((resolve, reject) => {
      natsClient.emit(event.pattern, event).subscribe({
        complete: () => resolve(),
        error: reject,
      });
    });
  };

  const publishOn = async (
    pattern: string,
    payload: unknown,
  ): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      natsClient.emit(pattern, payload).subscribe({
        complete: () => resolve(),
        error: reject,
      });
    });
  };

  const track = (socket: ClientSocket): ClientSocket => {
    clients.push(socket);
    return socket;
  };

  const connectRaw = (cookie: string): ClientSocket =>
    track(
      io(wsUrl, {
        forceNew: true,
        transports: ['websocket'],
        extraHeaders: { cookie },
      }),
    );

  const connectClient = (
    overrides: Partial<JwtPayload> = {},
  ): Promise<ClientSocket> => {
    const token = signAccessToken(buildJwtPayload(overrides));
    const socket = connectRaw(`${ACCESS_COOKIE}=${token}`);

    // Resolves on `connection:ready`, NOT on `connect`.
    //
    // Socket.IO fires `connect` the moment the transport is up, which is before
    // the server has verified the token and joined the identity rooms. A test
    // that emitted on `connect` would race `handleConnection` and fail
    // intermittently — which is exactly how this was found.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for connection:ready')),
        5_000,
      );
      socket.on('connection:ready', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.on('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  };

  const redis = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
    maxRetriesPerRequest: 3,
  });

  const close = async (): Promise<void> => {
    for (const socket of clients) socket.disconnect();
    clients.length = 0;
    await natsClient.close();
    await redis.quit().catch(() => undefined);
    await app.close();
  };

  return {
    app,
    stubs,
    wsUrl,
    publish,
    publishOn,
    connectClient,
    connectRaw,
    redis,
    close,
  };
}

/**
 * Resolves with the first matching frame, or rejects with a message naming the
 * event that never arrived.
 *
 * A bare `socket.on(...)` inside a test never fails — it just never runs, and
 * jest reports the suite timeout instead of the missing event. The named
 * rejection is the difference between "something is wrong" and "message:new
 * never arrived".
 */
export function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 3_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for '${event}'`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/**
 * Resolves with the first frame the predicate accepts, ignoring the rest.
 *
 * **`waitForEvent` takes the FIRST frame, and that is an arrangement which
 * assumes an idle machine** — known gap #13's second sighting. A client that
 * connects to an org room receives its own connect-time `presence: online`
 * from `announceConnected`; on an idle box that broadcast lands before the
 * test registers a listener, and under a full run it can land after, so the
 * listener resolves with `online` where the test meant to observe `away`.
 *
 * Waiting for the frame the test is actually about removes the race rather
 * than widening a window around it — the fix shape the row asks for: "make
 * the arrangement wait for the thing it is racing rather than assume it has
 * already happened."
 */
export function waitForMatchingEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  match: (payload: T) => boolean,
  timeoutMs = 3_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handler = (payload: T) => {
      if (!match(payload)) return;

      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for a matching '${event}'`));
    }, timeoutMs);

    socket.on(event, handler);
  });
}

/**
 * Resolves TRUE if the event does NOT arrive within the window.
 *
 * The negative case needs its own helper because "assert nothing happened"
 * cannot be written as an assertion on a value — it can only be written as a
 * wait that completes. Kept short deliberately: this runs on every isolation
 * test, and a long window is dead time in the suite.
 */
export function expectNoEvent(
  socket: ClientSocket,
  event: string,
  windowMs = 500,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, windowMs);

    const handler = () => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(false);
    };
    socket.once(event, handler);
  });
}
