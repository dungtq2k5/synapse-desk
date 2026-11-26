import { GatewayTimeoutException, Logger } from '@nestjs/common';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import {
  GRPC_DEADLINE_MS,
  packRequestContext,
  type GrpcPeer,
} from '@synapsedesk/grpc-proto';
import {
  CallerContext,
  RequestContext,
  RequestOrigin,
} from '@synapsedesk/contracts';
import {
  catchError,
  firstValueFrom,
  Observable,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';

const logger = new Logger('BaseGrpcClient');

/**
 * Shared behaviour for every gateway -> service gRPC adapter.
 *
 * Extending this rather than copying `call()` into each client means the
 * deadline, the timeout translation and the metadata packing exist once. A
 * client that forgot any of them would fail in a way nobody notices until
 * production: no deadline is a hung request, no metadata is an audit row with
 * an empty IP.
 *
 * The `GatewayTimeoutException` mapping lives here rather than in
 * `packages/grpc-proto` on purpose — 504 is an HTTP concept, and auth-service has
 * no business importing it.
 */
export abstract class BaseGrpcClient {
  /** Named in the timeout message so a 504 says which peer went quiet. */
  protected abstract readonly serviceName: GrpcPeer;

  /**
   * Where outbound gRPC latency is recorded.
   *
   * **A static, set once by `MetricsRegistry`'s constructor**, and this is the
   * one place in the gateway that uses one. Every gRPC client extends this
   * class, so the alternative is threading a registry through twenty
   * constructors for a measurement none of them care about — and the one client
   * somebody forgets to update is invisible in exactly the way the metric
   * exists to prevent.
   *
   * Optional, so a test that boots a client without the metrics module gets a
   * no-op rather than a crash.
   */
  private static durations?: GrpcDurationMetric;

  static useMetrics(metric: GrpcDurationMetric): void {
    BaseGrpcClient.durations = metric;
  }

  /**
   * Runs a unary call with the shared deadline, packing the caller's context
   * into metadata first.
   *
   * `invoke` receives the metadata rather than the caller building it, so no
   * call site can forget to pass it.
   *
   * Takes the union deliberately. An authenticated controller passes its full
   * `RequestContext` and the tenant travels with the call automatically; an
   * unauthenticated one (login, register, invitation preview) passes a bare
   * origin, and the service sees a caller with no identity — which is exactly
   * what it is.
   *
   * `peer` names the process the call reaches. It defaults to this client's
   * `serviceName`; only a client that talks to several processes (the job-health
   * fan-out) passes it, so a failing peer is counted against itself.
   */
  protected async call<T>(
    invoke: (metadata: Metadata) => Observable<T>,
    origin: RequestOrigin | RequestContext | CallerContext,
    deadlineMs: number = GRPC_DEADLINE_MS,
    peer: GrpcPeer = this.serviceName,
  ): Promise<T> {
    const started = process.hrtime.bigint();
    let code = 'OK';

    try {
      return await firstValueFrom(
        invoke(packRequestContext(origin)).pipe(
          timeout(deadlineMs),
          catchError((error: unknown) =>
            throwError(() =>
              error instanceof TimeoutError
                ? new GatewayTimeoutException(`${peer} did not respond in time`)
                : error,
            ),
          ),
        ),
      );
    } catch (error) {
      code = grpcCodeOf(error);
      throw error;
    } finally {
      BaseGrpcClient.durations?.observe(
        { peer, code },
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    }
  }
}

/**
 * `{peer, code}` — and deliberately NOT `{method}`, which the metrics table
 * lists.
 *
 * The method name is not available here: `invoke` is an opaque closure, and
 * capturing it would mean an extra argument at every one of the ~20 clients'
 * call sites. A metric that reported `method="unknown"` for most calls would be
 * worse than one that does not claim to know — so the label is omitted rather
 * than faked, and adding it later is a purely additive change.
 *
 * `{peer, code}` still answers the questions that matter first: which peer is
 * slow, and which peer is erroring.
 */
type GrpcDurationMetric = {
  observe: (labels: { peer: string; code: string }, value: number) => void;
};

/**
 * The gRPC status NAME (`NOT_FOUND`), whether the gateway timed out or the peer
 * answered. Anything that isn't a gRPC status is `UNKNOWN`, logged with the
 * error's type, since the label alone hides what reached here.
 *
 * @example grpcCodeOf({ code: 5 }) // 'NOT_FOUND'
 */
export function grpcCodeOf(error: unknown): string {
  if (error instanceof GatewayTimeoutException) return 'DEADLINE_EXCEEDED';

  const code = (error as { code?: unknown } | null)?.code;
  const name = typeof code === 'number' ? GrpcStatus[code] : undefined;
  if (name !== undefined) return name;

  logger.error(
    `A gRPC call failed with ${describe(error)}, which carries no gRPC status; labeled UNKNOWN`,
  );
  return 'UNKNOWN';
}

/** The error's type, and its `code` when it has one. */
function describe(error: unknown): string {
  const type = error instanceof Error ? error.constructor.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;

  return code === undefined ? type : `${type} (code ${JSON.stringify(code)})`;
}
