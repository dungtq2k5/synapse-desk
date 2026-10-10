import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { concatMap, type Observable } from 'rxjs';
import { formatErrorMsg } from '@synapsedesk/common';
import { RequestContextService } from '../contexts/request.context';
import { CacheService } from '../cache/cache.service';
import {
  INVALIDATE_CACHE_KEY,
  type CacheInvalidationTarget,
} from '../decorators/invalidate-cache.decorator';

/**
 * Runs `@InvalidateCache`, the FAST path.
 *
 * **The fast path, not the mechanism.** It sees writes that went through this
 * gateway and nothing else: a ticket also changes over the WebSocket, inside
 * `ticket-service`'s escalation side effects, and from a scheduled job. Those
 * are `CacheInvalidationConsumer`'s, and shipping this half alone would teach
 * everyone that invalidation is handled while covering one origin out of four.
 *
 *
 * Where it IS the whole story is a scope whose only writer is a gateway
 * mutation — `departments`, and the four handlers that write a user's name or
 * avatar. Those have no origin fan-out to miss.
 */
@Injectable()
export class CacheInvalidationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInvalidationInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = this.reflector.getAllAndOverride<
      CacheInvalidationTarget[] | undefined
    >(INVALIDATE_CACHE_KEY, [context.getHandler(), context.getClass()]);

    if (!targets?.length) return next.handle();

    return next.handle().pipe(
      // **`concatMap`, not `tap`.** The response waits for the eviction, and it
      // has to: a client that mutates and immediately re-reads is the normal
      // shape of a form submit, and an eviction still in flight when that GET
      // arrives serves the pre-write value — the exact staleness this exists to
      // prevent, made rarer and therefore harder to reproduce.
      //
      // `concatMap` also means it runs ONLY on success. An error skips the
      // operator entirely, which is what makes "after the handler succeeded"
      // true rather than merely intended.
      concatMap(async (value: unknown) => {
        await this.invalidate(context, targets);

        return value;
      }),
    );
  }

  private async invalidate(
    context: ExecutionContext,
    targets: CacheInvalidationTarget[],
  ): Promise<void> {
    // **The tenant, from the request context and nowhere else**.
    const request = context.switchToHttp().getRequest<Request>();
    const caller = RequestContextService.fromRequest(request);

    // No tenant, nothing tenant-scoped to drop. A platform Super Admin writing
    // into a tenant they are not a member of lands here, and their write is
    // covered by TTL rather than by eviction — see the class note in
    // `CacheInvalidationConsumer` for why that is acceptable and where it stops
    // being so.
    if (!caller?.organizationId) return;

    for (const scope of resolveScopes(context, targets)) {
      try {
        await this.cache.invalidateScope(caller.organizationId, scope);
      } catch (error) {
        // `CacheService` already swallows its own Redis errors; this catches a
        // resolver that threw. Either way the write SUCCEEDED, and failing the
        // response now would tell the client their change did not happen.
        this.logger.error(
          `Cache invalidation failed for scope ${scope}: ${formatErrorMsg(error)}`,
        );
      }
    }
  }
}

/** Every target flattened to a scope string. */
function resolveScopes(
  context: ExecutionContext,
  targets: CacheInvalidationTarget[],
): string[] {
  return targets.flatMap((target) =>
    typeof target === 'string' ? [target] : target(context),
  );
}
