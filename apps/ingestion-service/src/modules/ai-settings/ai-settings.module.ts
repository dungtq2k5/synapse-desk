import { Global, Module } from '@nestjs/common';
import { AiSettingsService } from './ai-settings.service';
import { EntitlementsConsumer } from './entitlements.consumer';

/**
 * `@Global`, which this codebase otherwise reserves for genuinely
 * cross-cutting concerns — and this qualifies on both counts that matter.
 *
 * It is read by every future AI call site in the service (the worker's
 * embedding step, and whatever else names a model), so the alternative is
 * importing it into each of those modules. And it holds a per-tenant cache:
 * providing it twice would give two caches, so an invalidation would clear one
 * of them and the other would keep serving a downgraded tenant the premium
 * model — the exact §1.3 failure, reintroduced through DI rather than through
 * a missing event.
 */
@Global()
@Module({
  controllers: [EntitlementsConsumer],
  providers: [AiSettingsService],
  exports: [AiSettingsService],
})
export class AiSettingsModule {}
