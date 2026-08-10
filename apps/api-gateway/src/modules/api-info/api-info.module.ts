import { Module } from '@nestjs/common';
import { ApiInfoResolver } from './api-info.resolver';

/**
 * The build-identity query, as its own feature module.
 *
 * It used to be a provider of the module that configured the GraphQL driver,
 * and was the last thing keeping that module in the business of owning
 * resolvers. Every domain resolver moved to the feature module whose controller
 * it mirrors; this one had no feature to move to, so it got one — and with the
 * last provider gone, the wrapper had nothing left but a `forRootAsync` call,
 * which now sits directly in `app.module.ts` beside `ThrottlerModule`'s.
 *
 * So this module is what makes `Query.apiInfo` answerable without anything
 * owning resolvers that is not a feature.
 *
 * No `imports`: `ConfigService` comes from the globally-registered
 * `ConfigModule`, the same way every other module in the gateway reaches it.
 */
@Module({
  providers: [ApiInfoResolver],
})
export class ApiInfoModule {}
