import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RedisModule } from '../redis/redis.module';
import { CacheService } from './cache.service';
import { CacheInvalidationConsumer } from './cache-invalidation.consumer';
import { CacheInvalidationInterceptor } from '../interceptors/cache-invalidation.interceptor';
import { CacheableInterceptor } from '../interceptors/cacheable.interceptor';

/**
 * The shared cache.
 *
 * **In `common/cache/` rather than `common/services/`** — because the NATS
 * invalidation consumer in `common/cache/`, and a cache whose service and whose
 * eviction live in different folders is one where somebody adds a cached read
 * without ever seeing the eviction half.
 */
@Module({
  imports: [RedisModule],
  // A NATS consumer is a controller with no routes — it is how Nest discovers
  // `@EventPattern` handlers, exactly as `realtime` registers its three.
  controllers: [CacheInvalidationConsumer],
  providers: [
    CacheService,
    // **Global, so the decorator works wherever it is written.** Registered
    // per-controller instead, the one somebody forgets is a mutation whose
    // scope is never evicted — and that failure is silent by construction: the
    // read keeps serving its TTL, correctly by its own lights.
    { provide: APP_INTERCEPTOR, useClass: CacheInvalidationInterceptor },
    // The read half. Global for the same reason, and harmless on a route
    // without `@Cacheable` — it reads no metadata and hands the call straight
    // on.
    { provide: APP_INTERCEPTOR, useClass: CacheableInterceptor },
  ],
  exports: [CacheService],
})
export class CacheModule {}
