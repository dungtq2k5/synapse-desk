import { GatewayTimeoutException } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { GRPC_DEADLINE_MS, packRequestContext } from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import {
  catchError,
  firstValueFrom,
  Observable,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';

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
 * `libs/grpc-proto` on purpose — 504 is an HTTP concept, and auth-service has
 * no business importing it.
 */
export abstract class BaseGrpcClient {
  /** Named in the timeout message so a 504 says which peer went quiet. */
  protected abstract readonly serviceName: string;

  /**
   * Where outbound gRPC latency is recorded
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
   */
  protected async call<T>(
    invoke: (metadata: Metadata) => Observable<T>,
    origin: RequestOrigin | RequestContext,
    deadlineMs: number = GRPC_DEADLINE_MS,
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
                ? new GatewayTimeoutException(
                    `${this.serviceName} did not respond in time`,
                  )
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
        { peer: this.serviceName, code },
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

/** The gRPC status name, or the shape of whatever else came back. */
function grpcCodeOf(error: unknown): string {
  if (error instanceof GatewayTimeoutException) return 'DEADLINE_EXCEEDED';

  const code = (error as { code?: unknown })?.code;

  return typeof code === 'number' ? String(code) : 'UNKNOWN';
}
