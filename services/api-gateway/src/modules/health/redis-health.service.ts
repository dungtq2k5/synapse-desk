import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { formatErrorMsg } from '@synapsedesk/common';

/**
 * How long a readiness probe will wait on Redis before calling it down.
 *
 * **A probe that hangs is a probe that fails**. Kubernetes
 * gives a readiness check a few seconds and then counts the timeout as a
 * failure, so an unbounded check does not produce "unknown", it produces
 * not-ready *plus* a request holding a worker for the whole timeout. Bounding it
 * here means the answer is wrong-but-fast rather than right-but-too-late.
 */
const PROBE_TIMEOUT_MS = 1_000;

/**
 * Is Redis reachable from THIS instance?
 *
 * The one dependency that genuinely gates gateway readiness: sessions, the
 * throttler store and the Socket.IO adapter all run through it, so an instance
 * that cannot reach Redis serves errors on nearly every route — and **another
 * instance might not be in that state**.
 *
 * **Its own connection, deliberately.** Reusing the throttler's or the
 * adapter's client inverts the meaning of the check: those queue commands while
 * disconnected and retry, which is right for them and turns a probe into a
 * hang. This one fails fast and never queues.
 *
 * See `docs/decisions/0010-readiness-probes-do-not-cascade.md`.
 */
@Injectable()
export class RedisHealthService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisHealthService.name);
  private readonly redis: Redis;

  constructor(configService: ConfigService) {
    this.redis = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      // One attempt, then answer. A retrying client turns a down dependency
      // into a slow probe, which reads as a timeout rather than as the clean
      // `ready: false` an orchestrator can act on.
      maxRetriesPerRequest: 1,
      commandTimeout: PROBE_TIMEOUT_MS,
      // Without this, a command issued while disconnected is BUFFERED and
      // resolves whenever Redis comes back — so the probe would report UP the
      // moment the outage ended, having reported nothing at all during it.
      enableOfflineQueue: false,
      // Nothing else in the process should be affected by this client failing;
      // it exists to observe, not to serve.
      lazyConnect: false,
    });

    // ioredis emits `error` on an unreachable server and an unhandled `error`
    // event on an EventEmitter crashes Node. Logged at debug: during an outage
    // this fires continuously, and a warn per reconnect attempt would bury the
    // one line that matters.
    this.redis.on('error', (error) =>
      this.logger.debug(`Redis health probe error: ${formatErrorMsg(error)}`),
    );
  }

  /** UP only on a real PONG within {@link PROBE_TIMEOUT_MS}. */
  async isReachable(): Promise<boolean> {
    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis probe timed out')),
            PROBE_TIMEOUT_MS,
          ).unref(),
        ),
      ]);

      return pong === 'PONG';
    } catch (error) {
      this.logger.warn(`Redis is unreachable: ${formatErrorMsg(error)}`);
      return false;
    }
  }

  onApplicationShutdown(): void {
    // `disconnect` rather than `quit`, and synchronous as a result: a client
    // whose server is unreachable cannot complete a QUIT handshake, and awaiting
    // one would hold SIGTERM open for exactly the outage this class exists to
    // report.
    this.redis.disconnect();
  }
}
