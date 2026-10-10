import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GqlContextType } from '@nestjs/graphql';
import { map, Observable } from 'rxjs';
import type { Response } from 'express';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import type { SuccessResponse } from '../interfaces/http-response.interface';

/**
 * Per-request bag on the Express response, for values only known at runtime.
 *
 * A handler that computes a message or warning mid-flight writes it here rather
 * than returning it, which keeps the handler's return value pure data.
 */
type ResponseLocals = {
  message?: string;
  warning?: string;
};

/**
 * Wraps every successful REST response in one envelope:
 * `{ success, statusCode, message, warning, data }`.
 *
 * This is the success-path counterpart to `AllHttpExceptionFilter`, which
 * already emits `{ success: false, statusCode, path, timestamp, error }`. With
 * only the filter in place, clients had to branch on HTTP status to know which
 * shape they were parsing; with both, `success` is the single discriminant.
 *
 * Handlers must return RAW DATA and never wrap it themselves — a handler that
 * returns `{ message, data }` ends up double-wrapped.
 *
 * `message` and `warning` resolve from two sources, dynamic winning over static:
 *   1. `response.locals.message` / `.warning`, set inside the handler.
 *   2. `@ResponseMessage('...')` metadata, read via Reflector.
 *
 * GraphQL passes straight through. Apollo owns its own response envelope
 * (`{ data, errors }`), and wrapping a resolver's return value would corrupt the
 * shape every GraphQL client expects.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  SuccessResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<T> | T> {
    if (context.getType<GqlContextType>() === 'graphql') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();
    const locals = response.locals as ResponseLocals;

    const staticMessage = this.reflector.getAllAndOverride<string | undefined>(
      RESPONSE_MESSAGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        // Read inside map(), not before: the handler may have changed it (a
        // 201 from @HttpCode, or res.status() directly), and reading early
        // would report the pre-handler value.
        statusCode: response.statusCode,
        message: locals.message ?? staticMessage ?? 'OK',
        warning: locals.warning ?? null,
        // `?? null` rather than leaving undefined: `JSON.stringify` drops
        // undefined keys entirely, so a void handler would emit an envelope
        // with no `data` field at all and break clients that read it blindly.
        data: (data ?? null) as T,
      })),
    );
  }
}
