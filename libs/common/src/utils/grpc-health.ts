import { Injectable, Logger } from '@nestjs/common';
import { formatErrorMsg } from './utils';

/**
 * One dependency this service owns, and how to ask it whether it is there.
 *
 * A named function rather than a client object, so the check can be whatever
 * proves reachability cheaply: a `SELECT 1`, a NATS connection flag, a Redis
 * PING. What it must NOT be is a call to another service — see
 * {@link GrpcHealthService}.
 */
export type DependencyProbe = {
  name: string;
  check: () => Promise<boolean>;
};

/**
 * How long the whole readiness answer may take — 23-doc §2 test 4.
 *
 * Every probe races this. A dependency that has stopped answering does not
 * usually refuse a connection; it accepts one and never replies, so an
 * unbounded check hangs for the kubelet's entire probe timeout and then counts
 * as a failure anyway — having also held a connection open for the duration.
 * Bounded means the answer is wrong-and-fast rather than right-and-too-late.
 */
export const READINESS_PROBE_TIMEOUT_MS = 2_000;

export const SERVING = 1;
export const NOT_SERVING = 2;

/**
 * The gRPC health service every backing service registers — 23-doc §2.
 *
 * **Kubernetes could not tell whether any of these processes was alive.** They
 * are `createMicroservice`-only, so there was no HTTP endpoint to probe, and
 * adding an HTTP server to a gRPC service means a listener, a port and a config
 * surface for one route. The standard `grpc.health.v1.Health` service rides the
 * port that already exists and the kubelet speaks it natively.
 *
 * **Liveness and readiness are genuinely different questions here**, split by
 * the `service` field the caller sends:
 *
 *   - `""` — *is this process alive?* Checks NOTHING. A restart repairs only a
 *     wedged process, and killing a healthy container because its database is
 *     down removes an instance that could still serve reads, in the middle of an
 *     incident, from every replica at once.
 *   - `"readiness"` — *can it serve?* Checks what this service OWNS.
 *
 * **No service probes another service**, and that is the rule that stops §1's
 * cascade recurring one level down. `ingestion-service` needing `auth-service`
 * for entitlements does not make `auth-service` part of its readiness: it would
 * make one Postgres failure into a cluster-wide not-ready, by exactly the
 * mechanism the gateway's readiness bug used. The rule decays first because
 * "just check the peer too" always looks helpful, so there is a static test
 * asserting it.
 *
 * Shared here rather than copied per service — the same shape as
 * {@link JobRunRecorder}: behaviour once, wired per service, because the six
 * copies would differ within a month and the one that drifts is the one nobody
 * probes.
 */
@Injectable()
export class GrpcHealthService {
  private readonly logger = new Logger(GrpcHealthService.name);

  /**
   * Set on shutdown, so readiness reports NOT_SERVING while in-flight requests
   * drain — 23-doc §1's "a partial outage should look partial", applied to a
   * deploy. Without it the pod keeps accepting new work right up to the moment
   * it closes its listener, and those requests fail rather than being routed
   * elsewhere.
   */
  private draining = false;

  constructor(private readonly dependencies: DependencyProbe[]) {}

  /** Called from `onApplicationShutdown` so the probe goes red before the port does. */
  startDraining(): void {
    this.draining = true;
  }

  /**
   * Liveness. Deliberately returns SERVING unconditionally.
   *
   * If this method can run, the process is alive — which is the entire question.
   * Anything else it might check is a reason to route traffic away, not a reason
   * to kill the container.
   */
  liveness(): { status: number } {
    return { status: SERVING };
  }

  /** Readiness: every owned dependency, bounded, in parallel. */
  async readiness(): Promise<{ status: number }> {
    if (this.draining) return { status: NOT_SERVING };

    // In PARALLEL: four sequential 2s checks would make a probe that Kubernetes
    // times out at 3s fail whenever any one of them is merely slow.
    const results = await Promise.all(
      this.dependencies.map((dependency) => this.probe(dependency)),
    );

    return { status: results.every(Boolean) ? SERVING : NOT_SERVING };
  }

  private async probe(dependency: DependencyProbe): Promise<boolean> {
    try {
      const healthy = await Promise.race([
        dependency.check(),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), READINESS_PROBE_TIMEOUT_MS).unref(),
        ),
      ]);

      if (!healthy) {
        this.logger.warn(`Readiness: ${dependency.name} is not available`);
      }

      return healthy;
    } catch (error) {
      // A throwing probe is a failing probe. Reported rather than propagated:
      // an exception escaping here would answer the health check with a gRPC
      // error, which a kubelet reads as "unknown" rather than "not ready".
      this.logger.warn(
        `Readiness: ${dependency.name} threw — ${formatErrorMsg(error)}`,
      );
      return false;
    }
  }
}

/**
 * Postgres, via the connection the service already holds.
 *
 * `SELECT 1` rather than a real query: it proves the pool has a live connection
 * and touches no table, so it cannot start failing because a migration renamed
 * something. **No new connection is opened** — 23-doc §2 test 4. A probe every
 * five seconds that connects is a connection leak with a schedule, and it is
 * the shape a health check most often takes when written in a hurry.
 */
export function postgresProbe(prisma: {
  $queryRawUnsafe: (query: string) => Promise<unknown>;
}): DependencyProbe {
  return {
    name: 'postgres',
    check: async () => {
      await prisma.$queryRawUnsafe('SELECT 1');
      return true;
    },
  };
}

/**
 * NATS, via the `ClientProxy` this service publishes through.
 *
 * `connect()` returns the EXISTING connection when there is one and only dials
 * when there is not, so this reuses the client rather than adding a connection
 * per probe. It also means the first probe after a broker restart is what
 * re-establishes the link, which is a small bonus rather than the point.
 */
export function natsProbe(client: {
  connect: () => Promise<unknown>;
}): DependencyProbe {
  return {
    name: 'nats',
    check: async () => {
      await client.connect();
      return true;
    },
  };
}

/** Redis, via an existing ioredis client. Same no-new-connection rule. */
export function redisProbe(
  redis: { ping: () => Promise<string> },
  name = 'redis',
): DependencyProbe {
  return {
    name,
    check: async () => (await redis.ping()) === 'PONG',
  };
}
