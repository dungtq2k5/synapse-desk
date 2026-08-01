import { GatewayTimeoutException } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { GRPC_DEADLINE_MS, packRequestOrigin } from '@synapsedesk/grpc-proto';
import { RequestOrigin } from '@synapsedesk/common';
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
   * Runs a unary call with the shared deadline, packing the caller's origin
   * into metadata first.
   *
   * `invoke` receives the metadata rather than the caller building it, so no
   * call site can forget to pass it.
   */
  protected call<T>(
    invoke: (metadata: Metadata) => Observable<T>,
    origin: RequestOrigin,
    deadlineMs: number = GRPC_DEADLINE_MS,
  ): Promise<T> {
    return firstValueFrom(
      invoke(packRequestOrigin(origin)).pipe(
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
  }
}
