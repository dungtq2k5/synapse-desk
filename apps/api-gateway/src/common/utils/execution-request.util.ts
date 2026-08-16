import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import type { Request } from 'express';

/**
 * The underlying Express request, whichever transport is executing
 * step 1.
 *
 * **The same Express request object on both.** Apollo is mounted on the same
 * HTTP server, so a GraphQL operation carries the request its POST arrived on —
 * cookies, headers, and whatever a guard has already attached to it. That is
 * what makes one authentication path serve both surfaces rather than two.
 *
 * `getType<GqlContextType>()` is the supported way to branch: GraphQL is not one
 * of Nest's built-in context types, so the generic parameter is what widens the
 * union to include it. Without it, `getType()` is typed as `'http' | 'rpc' |
 * 'ws'` and the comparison against `'graphql'` does not compile.
 *
 * **Extracted rather than repeated**, because it is now needed in five places —
 * `LoggingInterceptor`, `TransformInterceptor`, `Jwt2faGuard`,
 * `AllHttpExceptionFilter` and, as of this document, `@CurrentUser`. The one
 * that was missing it returned `null` in every resolver and surfaced as a
 * misleading 500 about a missing guard (docs/reference/known-gaps.md #6), which is exactly
 * the shape of bug a fifth hand-written copy produces.
 */
export function requestOf(context: ExecutionContext): Request | undefined {
  if (context.getType<GqlContextType>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req?: Request }>()
      .req;
  }

  return context.switchToHttp().getRequest<Request>();
}
