import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO over Redis pub/sub, so a broadcast reaches clients on EVERY replica.
 *
 * Without it everything works perfectly on one instance and fails silently on
 * two: a client connected to replica A never hears an event emitted on replica
 * B, because the default in-memory adapter only knows about its own process's
 * sockets. Nothing errors — the message is simply delivered to a subset of the
 * room and the rest of the room waits forever.
 *
 * ```txt
 *                         ┌──────────────────────────┐
 *                         │  Server Node 1           │
 *                         │  └─ Room "user:42"       │
 *                         │      └─ Socket AAA (Tab1)│
 *    ┌───────────────┐    ├──────────────────────────┤
 *    │ Redis Pub/Sub │──> │                          │
 *    └───────────────┘    │  Server Node 2           │
 *                         │  └─ Room "user:42"       │
 *                         │      └─ Socket BBB (Tab2)│
 *                         └──────────────────────────┘
 * ```
 *
 * `ioredis` rather than `@keyv/redis` or `node-redis`: it is already this
 * gateway's Redis client for the throttler storage and the organization-status
 * cache. A second client library in one process is a second connection pool, a
 * second set of retry semantics and a second thing to configure, for no gain.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);

  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  /**
   * Must be awaited BEFORE `useWebSocketAdapter`, because `createIOServer` runs
   * synchronously when the first gateway initializes and cannot wait for a
   * connection that has not been made.
   *
   * Async by CONTRACT rather than by current implementation — ioredis connects
   * lazily, so nothing here awaits today. Callers must still await it: a future
   * eager connect, or a `ping()` health check added here, would otherwise
   * silently start racing `createIOServer` with no call site left to change.
   */
  connect(): Promise<void> {
    const url = this.configService.getOrThrow<string>('REDIS_URL');

    // TWO connections, not one. A Redis client in subscriber mode may issue no
    // other commands, so the publishing half has to be a separate connection —
    // `duplicate()` is how ioredis expresses that with the same config.
    this.pubClient = new Redis(url, { maxRetriesPerRequest: 3 });
    this.subClient = this.pubClient.duplicate();

    // Logged, never thrown: a Redis blip must degrade real-time delivery, not
    // take the whole gateway down with it. The HTTP API does not depend on this.
    this.pubClient.on('error', (error) =>
      this.logger.error(`Redis pub client error: ${error.message}`),
    );
    this.subClient.on('error', (error) =>
      this.logger.error(`Redis sub client error: ${error.message}`),
    );

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.IO Redis adapter connected');

    return Promise.resolve();
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // `IoAdapter.createIOServer` is typed `any` — this is the one place that
    // untyped return is narrowed, so every caller below sees a real `Server`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const server: Server = super.createIOServer(port, options);

    // Guarded rather than assumed: if `connect()` was never awaited, running
    // with the in-memory adapter is the WORSE failure — it works in dev and
    // drops half the messages in production. A loud warning at boot is the only
    // moment anyone would notice.
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    } else {
      this.logger.warn(
        'Socket.IO is running WITHOUT the Redis adapter — events will not ' +
          'cross replicas. connect() was not awaited before useWebSocketAdapter().',
      );
    }

    return server;
  }

  /**
   * Fields are nulled BEFORE the awaits.
   *
   * `close()` can be re-entered — Nest calls it per server, and a shutdown hook
   * may race it — and quitting an already-quit ioredis client throws. Taking
   * local references and clearing the fields first makes the second call a
   * no-op instead of an error thrown during shutdown, where nothing is left to
   * catch it.
   */
  async disconnect(): Promise<void> {
    const pub = this.pubClient;
    const sub = this.subClient;
    this.pubClient = null;
    this.subClient = null;

    for (const [name, client] of [
      ['pub', pub],
      ['sub', sub],
    ] as const) {
      if (!client) continue;
      try {
        await client.quit();
      } catch (error) {
        this.logger.error(
          `Error closing Redis ${name} client: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Nest calls this from `app.close()`. Overriding it is what stops the two
   * Redis connections outliving the process — the exact leak that made the
   * throttler's un-owned client hang the test suite until it was traced.
   */
  override async close(server: Server): Promise<void> {
    // Socket.IO FIRST, Redis second.
    //
    // The order is not cosmetic: `@socket.io/redis-adapter` holds the
    // subscription and keeps using both connections until the server it is
    // attached to is torn down. Quitting Redis first leaves the adapter talking
    // to closed sockets, which surfaces as an ioredis "Connection is closed"
    // thrown from a close handler — asynchronously, after the process has moved
    // on, where nothing is left to catch it.
    await super.close(server);
    await this.disconnect();
  }
}
