import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';

export type ServiceHealth = 'UP' | 'DOWN' | 'UNKNOWN';

export type ServiceEndpoint = {
  name: string;
  url: string;
  health: ServiceHealth;
  lastChecked: Date;
};

/**
 * Tracks whether this gateway's gRPC peers are reachable — reported BY
 * `/health/ready`, and deliberately not gating it.
 *
 * **Lives in api-gateway, not `libs/common`.** Two reasons, and the second is
 * the binding one:
 *
 *   1. The gateway is the only consumer. Per the conventions, one consumer means
 *      keep it local — and the peer list it seeds itself from (`AUTH_SERVICE_URL`)
 *      is gateway configuration, so a second consumer could not reuse it as-is
 *      anyway.
 *   2. `libs/common` MUST NOT import `@grpc/grpc-js`. That library is the wire,
 *      and the wire lives in `libs/grpc-proto`. A domain-types package that
 *      transitively drags in a gRPC runtime is one every service pays for,
 *      including notification-service, which speaks only NATS.
 *
 * If a second service later needs peer health, the reusable part is the
 * connectivity-state mapping, not this class — that would move to
 * `libs/grpc-proto` where the gRPC dependency already belongs.
 */
@Injectable()
export class ServiceRegistry implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ServiceRegistry.name);

  private readonly services = new Map<string, ServiceEndpoint>();

  /**
   * ONE long-lived channel per peer, created at boot.
   *
   * The previous version built a fresh `grpc.Channel` inside every health check
   * and never closed it, leaking a socket and its keepalive timer per probe —
   * and a brand-new channel always reports IDLE, so it could never observe a
   * peer actually being reachable. A persistent channel is also what makes
   * `getConnectivityState` meaningful: it reports the state of a connection
   * that has had time to establish.
   */
  private readonly channels = new Map<string, grpc.Channel>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * EVERY gRPC peer, not just auth-service
   *
   * Registering one peer was defensible while peer state gated readiness: the
   * fewer peers listed, the smaller the cascade. Now that it gates nothing, the
   * list is a diagnostic, and a diagnostic that shows one of five peers is worse
   * than none — it invites "auth is up, so the peers are fine" during an
   * incident caused by one of the four it never looked at.
   */
  onModuleInit(): void {
    const peers = {
      auth: 'AUTH_SERVICE_URL',
      ticket: 'TICKET_SERVICE_URL',
      ingestion: 'INGESTION_SERVICE_URL',
      notification: 'NOTIFICATION_SERVICE_URL',
      rag: 'RAG_SERVICE_URL',
    } as const;

    for (const [name, variable] of Object.entries(peers)) {
      this.register(name, this.configService.getOrThrow<string>(variable));
    }
  }

  /**
   * Closes every channel on shutdown.
   *
   * Without this the process holds open sockets and keepalive timers, and Nest's
   * `enableShutdownHooks()` waits on an event loop that never drains — a
   * container that will not exit on SIGTERM.
   */
  onApplicationShutdown(): void {
    for (const [name, channel] of this.channels) {
      channel.close();
      this.logger.debug(`Closed health channel for ${name}`);
    }
    this.channels.clear();
  }

  register(name: string, url: string): void {
    this.services.set(name, {
      name,
      url,
      health: 'UNKNOWN',
      lastChecked: new Date(),
    });
    this.channels.set(
      name,
      // Insecure is correct for in-cluster traffic; TLS terminates at the edge.
      new grpc.Channel(url, grpc.credentials.createInsecure(), {}),
    );

    this.logger.log(`Registered service: ${name} at ${url}`);
  }

  /**
   * Probes every peer and returns the fresh result.
   *
   * Checked ON DEMAND rather than from a background sweep. The old design cached
   * a value refreshed "every 10s" by a method nothing ever called, so
   * `/health/ready` reported UNKNOWN forever. A readiness probe must answer for
   * *now* — and the probe is a cheap local state read, not a network round trip.
   *
   * **Synchronous, which is what bounds it** test 4.
   * `getConnectivityState` reads a value the channel already maintains, so an
   * unreachable peer costs nothing and cannot hang the probe. A version that
   * sent a real `Check` RPC per peer would be more accurate and would put five
   * network round trips inside a call Kubernetes gives a few seconds.
   */
  checkAll(): Record<string, ServiceEndpoint> {
    const status: Record<string, ServiceEndpoint> = {};

    for (const [name, endpoint] of this.services) {
      endpoint.health = this.probe(name);
      endpoint.lastChecked = new Date();
      status[name] = { ...endpoint };
    }

    return status;
  }

  getService(name: string): ServiceEndpoint | undefined {
    return this.services.get(name);
  }

  /**
   * Maps gRPC connectivity state onto UP/DOWN.
   *
   * The previous version wrapped `getConnectivityState` in a try/catch and
   * assumed a throw meant DOWN. It does not throw — it RETURNS a state enum — so
   * every peer was reported UP unconditionally, including one that was not
   * running. This reads the returned state instead.
   *
   * `true` asks the channel to start connecting if idle, which is what turns the
   * first probe after boot into a real attempt rather than a permanent IDLE.
   */
  private probe(name: string): ServiceHealth {
    const channel = this.channels.get(name);
    if (!channel) return 'UNKNOWN';

    const state = channel.getConnectivityState(true);

    switch (state) {
      case grpc.connectivityState.READY:
        return 'UP';
      case grpc.connectivityState.IDLE:
      case grpc.connectivityState.CONNECTING:
        // Not yet proven either way — reported as UNKNOWN rather than DOWN so a
        // gateway restarting alongside its peers does not flap to not-ready
        // during the seconds before the first connection completes.
        return 'UNKNOWN';
      case grpc.connectivityState.TRANSIENT_FAILURE:
      case grpc.connectivityState.SHUTDOWN:
      default:
        this.logger.warn(
          `Service ${name} is DOWN (state: ${grpc.connectivityState[state]})`,
        );
        return 'DOWN';
    }
  }
}
