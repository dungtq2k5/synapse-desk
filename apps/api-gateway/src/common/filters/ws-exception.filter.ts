import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { formatErrorMsg } from '@synapsedesk/common';
import { ErrorResponse } from '../interfaces/http-response.interface';

/**
 * The terminal error handler for every gateway, mirroring
 * `AllHttpExceptionFilter` on the HTTP side.
 *
 * Two things it buys:
 *
 *   1. **One error shape across transports.** The frame carries the same
 *      `ErrorResponse` a REST call would, so a client has one parser and one
 *      `success` field to branch on rather than two.
 *   2. **The socket survives.** Nest's default behaviour for an unhandled
 *      gateway error is to emit a bare `exception` and, for a non-WsException,
 *      let it propagate — which in practice tears down a connection because one
 *      message had a bad id. Emitting and returning keeps the session alive,
 *      which is what a user with a half-typed reply expects.
 */
@Catch()
export class AllWsExceptionsFilter extends BaseWsExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    // A socket frame has no HTTP status, but the client's error handling is
    // written against one — so an HttpException keeps its own, and everything
    // else reports 400: the frame was accepted and its CONTENTS were the
    // problem, which is what 400 means.
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 400;

    const message =
      exception instanceof WsException
        ? exception.getError()
        : exception instanceof HttpException
          ? exception.getResponse()
          : exception instanceof Error
            ? exception.message
            : 'An unexpected real-time error occurred';

    client.emit('exception', {
      success: false,
      statusCode,
      // The namespace the client connected on — the nearest equivalent to a
      // request path, and the only routing information a frame carries.
      path: client.nsp?.name ?? '/',
      timestamp: new Date().toISOString(),
      error: formatErrorMsg(message),
    } satisfies ErrorResponse);
  }
}
