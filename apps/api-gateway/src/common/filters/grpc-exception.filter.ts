import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { Request, Response } from 'express';

/**
 * gRPC status -> HTTP status.
 *
 * Anything not listed here is a bug (or a genuinely unexpected failure) and is
 * deliberately collapsed to a 500 with a generic message, so internal details
 * from a downstream service never leak to the client.
 */
const GRPC_TO_HTTP: Partial<Record<number, HttpStatus>> = {
  [GrpcStatus.INVALID_ARGUMENT]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.FAILED_PRECONDITION]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.OUT_OF_RANGE]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [GrpcStatus.PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [GrpcStatus.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [GrpcStatus.ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [GrpcStatus.ABORTED]: HttpStatus.CONFLICT,
  [GrpcStatus.RESOURCE_EXHAUSTED]: HttpStatus.TOO_MANY_REQUESTS,
  [GrpcStatus.CANCELLED]: HttpStatus.REQUEST_TIMEOUT,
  [GrpcStatus.UNIMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
  [GrpcStatus.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [GrpcStatus.DEADLINE_EXCEEDED]: HttpStatus.GATEWAY_TIMEOUT,
};

type GrpcError = { code: number; details?: string; message?: string };

function isGrpcError(error: unknown): error is GrpcError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as GrpcError).code === 'number' &&
    (error as GrpcError).code in GrpcStatus
  );
}

/**
 * Translates errors thrown by downstream gRPC services into HTTP responses.
 *
 * Without this every RpcException surfaces as a generic 500, because a gRPC
 * status code means nothing to the HTTP layer. Registered globally so every
 * service added later inherits it for free.
 */
@Catch()
export class GrpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GrpcExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Errors raised by the gateway itself (validation, timeouts) are already
    // HTTP-shaped — leave them alone.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    let statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (isGrpcError(exception)) {
      const mapped = GRPC_TO_HTTP[exception.code];
      if (mapped !== undefined) {
        statusCode = mapped;
        message = exception.details ?? exception.message ?? message;
      } else {
        this.logger.error(
          `Unmapped gRPC status ${exception.code} (${GrpcStatus[exception.code]}) from ${request.method} ${request.url}: ${exception.details ?? exception.message}`,
        );
      }
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(statusCode).json({
      statusCode,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
