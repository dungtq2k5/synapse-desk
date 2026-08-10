import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { formatErrorMsg, MaybeJwtPayload } from '@synapsedesk/common';

/** What every transport boils down to for logging purposes. */
type CallDescription = {
  transport: 'HTTP' | 'GraphQL';
  /** `POST /api/v1/auth/login` or `Query.me`. */
  label: string;
  actor: string;
};

/**
 * Logs every request and how long it took.
 *
 * Polymorphic over transports because the gateway serves both REST and GraphQL
 * from the same process, and `switchToHttp()` on a GraphQL call returns an
 * empty shell — `method` and `url` come back `undefined`, so a REST-only
 * interceptor quietly logs `undefined undefined` for half the traffic instead
 * of failing loudly.
 *
 * `isProduction` gates the per-request line, not the error line. Request
 * timings are a development aid and would be noise in production (and a mild
 * PII risk, since URLs carry ids) where the same data belongs in structured
 * metrics. Errors are always logged.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Requests');

  constructor(private readonly isProduction: boolean = false) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const call = this.describe(context);
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          if (this.isProduction) return;

          const elapsed = Date.now() - startedAt;
          const status =
            call.transport === 'HTTP'
              ? ` [${context.switchToHttp().getResponse<Response>().statusCode}]`
              : '';

          this.logger.debug(
            `${call.transport} ${call.label}${status} ${elapsed}ms (user: ${call.actor})`,
          );
        },
        error: (error: unknown) => {
          const elapsed = Date.now() - startedAt;
          this.logger.error(
            `${call.transport} ${call.label} [ERROR] ${elapsed}ms (user: ${call.actor}): ${formatErrorMsg(error)}`,
          );
        },
      }),
    );
  }

  /**
   * Normalizes the two transports into one shape.
   *
   * `getType<GqlContextType>()` is the supported way to branch — GraphQL is not
   * one of Nest's built-in context types, so the generic parameter is what
   * widens the union to include it.
   */
  private describe(context: ExecutionContext): CallDescription {
    if (context.getType<GqlContextType>() === 'graphql') {
      const gqlContext = GqlExecutionContext.create(context);
      const info = gqlContext.getInfo<{
        parentType: { name: string };
        fieldName: string;
      }>();
      // The GraphQL context carries the same Express request, so the actor is
      // resolved identically for both transports — see `requestOf`, which this
      // duplicates only because it also needs `info` from the same context.
      const request = gqlContext.getContext<{ req?: Request }>().req;

      return {
        transport: 'GraphQL',
        label: `${info.parentType.name}.${info.fieldName}`,
        actor: this.actorOf(request?.user),
      };
    }

    const request = context.switchToHttp().getRequest<Request>();

    return {
      transport: 'HTTP',
      label: `${request.method} ${request.url}`,
      actor: this.actorOf(request.user),
    };
  }

  private actorOf(user: MaybeJwtPayload | undefined): string {
    return user?.sub ?? 'anonymous';
  }
}
