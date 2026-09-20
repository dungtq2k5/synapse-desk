import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { GqlContextType } from '@nestjs/graphql';
import type { Request, Response } from 'express';
import type { ErrorResponse } from '../interfaces/http-response.interface';
import { clientSafeError } from './client-safe-message';

/**
 * The gateway's single terminal error handler, across every transport it serves.
 *
 * Three kinds of failure arrive here and each needs different treatment:
 *
 *  1. **HttpException** — raised by the gateway itself (validation, guards, the
 *     504 from a gRPC deadline). Already HTTP-shaped; pass the status through.
 *  2. **A gRPC error from a downstream service** — a status code that means
 *     nothing to HTTP. Without the mapping in `client-safe-message.ts`, every
 *     `RpcException` reaches the client as a blanket 500 and "wrong password"
 *     is indistinguishable from a crash.
 *  3. **Anything else** — a genuine bug. Logged with its stack, and reported as
 *     a bare 500 in production so internals never leak.
 *
 * GraphQL is handled by re-throwing rather than writing a response: Apollo owns
 * the response envelope there, and calling `response.status().json()` on a
 * GraphQL request writes into a socket Apollo is also writing to.
 */
@Catch()
export class AllHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllHttpExceptionFilter.name);

  /**
   * Passed in rather than injected: global filters are constructed with `new`
   * in main.ts, outside the DI container.
   */
  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { statusCode, message } = this.resolve(exception, host);

    if (host.getType<GqlContextType>() === 'graphql') {
      // Apollo formats the error envelope; normalize the message and re-throw.
      if (exception instanceof Error) exception.message = message;
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    response.status(statusCode).json({
      success: false,
      statusCode,
      path: request.url,
      timestamp: new Date().toISOString(),
      error: message,
    } satisfies ErrorResponse);
  }

  private resolve(
    exception: unknown,
    host: ArgumentsHost,
  ): { statusCode: number; message: string } {
    return clientSafeError(exception, {
      isProduction: this.isProduction,
      logger: this.logger,
      context: this.describe(host),
    });
  }

  /** Best-effort request label for logs; GraphQL has no method/url. */
  private describe(host: ArgumentsHost): string {
    if (host.getType<GqlContextType>() === 'graphql') {
      return 'a GraphQL operation';
    }

    const request = host.switchToHttp().getRequest<Request>();
    return `${request.method} ${request.url}`;
  }
}
