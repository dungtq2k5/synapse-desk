import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import {
  BILLING_PATTERNS,
  DOCUMENT_PATTERNS,
  TICKET_PATTERNS,
} from '@synapsedesk/common';
import { CacheInvalidationConsumer } from './cache-invalidation.consumer';
import { CacheInvalidationInterceptor } from '../interceptors/cache-invalidation.interceptor';
import { CACHE_SCOPES } from '../config/cache.config';
import type { CacheService } from './cache.service';

/** The subjects a method actually subscribes to, read back from metadata. */
const patternsOf = (method: (...args: never[]) => unknown): string[] =>
  (Reflect.getMetadata(PATTERN_METADATA, method) as string[]) ?? [];

describe('cache invalidation', () => {
  describe('§4.2 the consumer subscribes to what it claims', () => {
    it('**every ticket pattern, not just one**', () => {
      // The bug this pins is invisible in review and in production logs alike.
      // `@EventPattern` writes its metadata with
      // `Reflect.defineMetadata(PATTERN_METADATA, [].concat(metadata))` — it
      // OVERWRITES — so nine STACKED decorators subscribe to exactly one
      // pattern and the other eight events arrive to nobody, silently.
      expect(
        patternsOf(CacheInvalidationConsumer.prototype.ticketChanged).sort(),
      ).toEqual(Object.values(TICKET_PATTERNS).sort());
    });

    it('the three document patterns that change a readable row', () => {
      expect(
        patternsOf(CacheInvalidationConsumer.prototype.documentChanged).sort(),
      ).toEqual(
        [
          DOCUMENT_PATTERNS.indexed,
          DOCUMENT_PATTERNS.ingestionFailed,
          DOCUMENT_PATTERNS.scopeChanged,
        ].sort(),
      );
    });

    it('**but NOT `document.uploaded`**', () => {
      // The worker's trigger. Nothing is readable yet, so evicting on it drops
      // a warm cache to answer a question nobody asked.
      expect(
        patternsOf(CacheInvalidationConsumer.prototype.documentChanged),
      ).not.toContain(DOCUMENT_PATTERNS.uploaded);
    });

    it('and the billing event that 15-doc §1.3 already specified', () => {
      expect(
        patternsOf(CacheInvalidationConsumer.prototype.entitlementsChanged),
      ).toEqual([BILLING_PATTERNS.entitlementsChanged]);
    });
  });

  describe('§4.2 test 5 — a consumer failure never kills the process', () => {
    const consumerWith = (cache: Partial<CacheService>) =>
      new CacheInvalidationConsumer(cache as CacheService);

    it('a rejected invalidation is caught, not left to the process', async () => {
      // An unhandled rejection in a NATS handler takes the gateway down. A
      // failed invalidation costs one stale entry until its TTL. The two are
      // not close, which is why this is caught rather than propagated.
      const invalidateScope = jest
        .fn<Promise<number>, [string, string]>()
        .mockRejectedValue(new Error('Redis is down'));

      const consumer = consumerWith({ invalidateScope });

      expect(() =>
        consumer.ticketChanged({ organizationId: 'org-1' }),
      ).not.toThrow();

      // Let the rejection settle: an unhandled one surfaces after the tick, so
      // asserting synchronously would pass even if nothing caught it.
      await Promise.resolve();
      await Promise.resolve();

      expect(invalidateScope).toHaveBeenCalledWith(
        'org-1',
        CACHE_SCOPES.tickets,
      );
    });

    it('and an event with no tenant is logged, not thrown', () => {
      // Nest's NATS deserializer treats a payload carrying `pattern` as an
      // envelope and extracts its absent `.data`, so a raw publish delivers
      // `undefined` here. A producer-side bug must not be a gateway outage.
      const invalidateScope = jest.fn();
      const consumer = consumerWith({ invalidateScope });

      expect(() => consumer.ticketChanged(undefined)).not.toThrow();
      expect(() => consumer.ticketChanged({})).not.toThrow();
      expect(() =>
        consumer.ticketChanged({ organizationId: '' }),
      ).not.toThrow();

      // And it did not invent a tenant to invalidate.
      expect(invalidateScope).not.toHaveBeenCalled();
    });
  });

  describe('§4.1 test 2 — the decorator runs AFTER the handler', () => {
    /**
     * A request the real `RequestContextService.fromRequest` accepts.
     *
     * `permissionCodes` and `departmentIds` are not decoration: `isFullJwtPayload`
     * requires both, and a payload missing them is treated as a 2FA-challenge
     * token — so a thinner fake makes the interceptor no-op and every assertion
     * below pass for the wrong reason.
     */
    const contextFor = (organizationId: string | null) =>
      ({
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              sub: 'user-1',
              organizationId,
              permissionCodes: [],
              departmentIds: [],
              isEmailVerified: true,
            },
            ip: '127.0.0.1',
            get: () => 'jest',
          }),
        }),
      }) as never;

    const build = (targets: unknown, invalidateScope = jest.fn()) => {
      const reflector = {
        getAllAndOverride: () => targets,
      } as never;

      return {
        invalidateScope,
        interceptor: new CacheInvalidationInterceptor(reflector, {
          invalidateScope,
        } as unknown as CacheService),
      };
    };

    it('**the eviction happens after the handler emits, never before**', async () => {
      // Invalidating BEFORE the write lets a concurrent read repopulate the
      // entry with the pre-write value — which then survives its whole TTL. It
      // is strictly worse than not invalidating at all, and it is the shape
      // everybody writes first.
      const order: string[] = [];
      const invalidateScope = jest.fn(() => {
        order.push('invalidate');

        return Promise.resolve(1);
      });

      const { interceptor } = build(
        [CACHE_SCOPES.departments],
        invalidateScope,
      );

      const handler = {
        handle: () => {
          order.push('handler');

          return { subscribe: undefined } as never;
        },
      };

      // Driven through the real observable so the operator chain is what runs.
      const { of, lastValueFrom } = await import('rxjs');
      handler.handle = () => {
        order.push('handler');

        return of('handler result') as never;
      };

      const result = await lastValueFrom(
        interceptor.intercept(contextFor('org-1'), handler) as never,
      );

      expect(order).toEqual(['handler', 'invalidate']);
      expect(result).toBe('handler result');
    });

    it('**and not at all when the handler failed**', async () => {
      // Nothing was written, so there is nothing to evict — and dropping the
      // scope anyway turns every rejected request into a stampede against an
      // origin that just rejected something.
      const { interceptor, invalidateScope } = build([
        CACHE_SCOPES.departments,
      ]);
      const { throwError, lastValueFrom } = await import('rxjs');

      const handler = {
        handle: () => throwError(() => new Error('validation failed')) as never,
      };

      await expect(
        lastValueFrom(
          interceptor.intercept(contextFor('org-1'), handler) as never,
        ),
      ).rejects.toThrow('validation failed');

      expect(invalidateScope).not.toHaveBeenCalled();
    });

    it('resolves a function target against the request', async () => {
      const { interceptor, invalidateScope } = build([
        CACHE_SCOPES.users,
        () => 'entity:user:abc',
      ]);
      const { of, lastValueFrom } = await import('rxjs');

      await lastValueFrom(
        interceptor.intercept(contextFor('org-1'), {
          handle: () => of(null) as never,
        }) as never,
      );

      expect(invalidateScope.mock.calls).toEqual([
        ['org-1', CACHE_SCOPES.users],
        ['org-1', 'entity:user:abc'],
      ]);
    });

    it('and does nothing at all without a tenant', async () => {
      const { interceptor, invalidateScope } = build([CACHE_SCOPES.roles]);
      const { of, lastValueFrom } = await import('rxjs');

      await lastValueFrom(
        interceptor.intercept(contextFor(null), {
          handle: () => of(null) as never,
        }) as never,
      );

      expect(invalidateScope).not.toHaveBeenCalled();
    });
  });
});
