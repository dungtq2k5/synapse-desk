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
 */
export function requestOf(context: ExecutionContext): Request | undefined {
  if (context.getType<GqlContextType>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req?: Request }>()
      .req;
  }

  return context.switchToHttp().getRequest<Request>();
}
