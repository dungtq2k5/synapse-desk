import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import {
  GrpcHealthService,
  NOT_SERVING,
  type BuildInfo,
} from '@synapsedesk/common';
import { READINESS_SERVICE } from './constants';
import type {
  HealthCheckRequest,
  HealthCheckResponse,
} from './generated/grpc/health/v1/health';
import type { VersionResponse } from './generated/synapsedesk/ops/ops';

/** Each service binds this to its own `readBuildInfo(configService)` result. */
export const BUILD_INFO = Symbol('BUILD_INFO');

/**
 * The probe and version surface every gRPC service serves
 *
 * **In `libs/grpc-proto`, not `libs/common`**, and the split is the same one
 * `ServiceRegistry`'s docblock draws: `libs/common` is domain types, and a
 * `@GrpcMethod`-decorated controller is the wire. The decision logic — what to
 * check, how to bound it, what liveness must never look at — lives in
 * `GrpcHealthService` over there, where it can be unit-tested with no transport
 * at all. This file is the adapter.
 *
 * One implementation registered by every service, rather than six copies. Six
 * copies of a health check drift within a month, and the one that drifts is by
 * definition the one nobody is watching.
 */
@Controller()
export class OpsGrpcController {
  constructor(
    private readonly health: GrpcHealthService,
    @Inject(BUILD_INFO) private readonly buildInfo: BuildInfo,
  ) {}

  /**
   * `grpc.health.v1.Health/Check` — the method the kubelet calls.
   *
   * **The `service` field selects which question is being asked**, which is what
   * lets one port carry both probes:
   *
   * ```yaml
   * livenessProbe:  { grpc: { port: 50051, service: "" } }
   * readinessProbe: { grpc: { port: 50051, service: "readiness" } }
   * ```
   *
   * Anything else is `NOT_FOUND`, per the standard. Deliberately not "assume
   * liveness": a probe misconfigured with a typo'd service name would otherwise
   * pass forever, which is the failure that looks exactly like health.
   */
  @GrpcMethod('Health', 'Check')
  check(request: HealthCheckRequest): Promise<HealthCheckResponse> {
    const service = request.service ?? '';

    if (service === '') {
      return Promise.resolve(this.health.liveness());
    }
    if (service === READINESS_SERVICE) {
      return this.health.readiness();
    }

    throw new RpcException({
      code: status.NOT_FOUND,
      message: `Unknown health service '${service}'`,
    });
  }

  /**
   * `Watch` — declared by the standard, refused explicitly.
   *
   * Kubernetes uses `Check`, not `Watch`, so implementing a streaming health
   * feed would be a subscription with no subscriber. Refusing it with
   * UNIMPLEMENTED is the standard's own answer for a server that does not
   * support it — and saying so beats leaving a method that exists in the proto
   * and errors with something a caller has to guess at.
   */
  @GrpcMethod('Health', 'Watch')
  watch(): Observable<HealthCheckResponse> {
    return new Observable<HealthCheckResponse>((subscriber) => {
      subscriber.next({ status: NOT_SERVING });
      subscriber.error(
        new RpcException({
          code: status.UNIMPLEMENTED,
          message: 'Watch is not supported; use Check',
        }),
      );
    });
  }

  /**
   * `/version` for a service with no HTTP port.
   *
   * **Every service, not just the gateway.** A rolling deploy where one service
   * lagged is precisely the state this diagnoses, and a gateway-only version
   * endpoint reports the new SHA while the peer still running the old code is
   * the one causing the incident.
   */
  @GrpcMethod('OpsService', 'GetVersion')
  getVersion(): VersionResponse {
    return {
      version: this.buildInfo.version,
      sha: this.buildInfo.sha,
      builtAt: this.buildInfo.builtAt,
    };
  }
}
