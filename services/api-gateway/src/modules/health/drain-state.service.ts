import { Injectable, Logger } from '@nestjs/common';

/**
 * Whether this instance is shutting down, for the readiness probe to report.
 *
 * **The gateway is the only pod behind the Ingress, so its drain is the only
 * one a user can feel.** Kubernetes removes a terminating pod from the Service
 * endpoints and sends `SIGTERM` concurrently, so there is a window in which a
 * closing pod is still being routed to. A pod that reports unready FIRST is
 * taken out of the endpoint list before it stops accepting; one that does not
 * ends its in-flight requests when the grace period expires. For the five gRPC
 * services that is an internal RPC a caller retries. Here it is a user's
 * request.
 *
 * **Every other service already had this** — `GrpcHealthService.startDraining()`
 * called from each `OpsModule`'s `onApplicationShutdown`. This is the same
 * mechanism in the shape the gateway's HTTP probe needs; the gateway's
 * readiness previously went red only as a side effect of
 * `RedisHealthService.onApplicationShutdown` disconnecting its client, which is
 * late, indirect, and reports a Redis outage for what is an ordinary rollout.
 *
 * A `preStop` sleep in the manifest is the usual workaround and it is one: it
 * delays `SIGTERM` and hopes the endpoint update wins the race, rather than
 * making the pod say it is unready. This says it.
 */
@Injectable()
export class DrainState {
  private readonly logger = new Logger(DrainState.name);

  private draining = false;

  /** Called from `HealthModule.onApplicationShutdown`. Idempotent. */
  startDraining(): void {
    if (this.draining) return;

    this.draining = true;
    this.logger.log('Draining — readiness now reports NOT ready');
  }

  isDraining(): boolean {
    return this.draining;
  }
}
