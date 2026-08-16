import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import {
  AUTH_GRPC_CLIENT,
  INGESTION_GRPC_CLIENT,
} from '@synapsedesk/grpc-proto';
import { getGraphqlConfig } from '../config/graphql.config';
import { AuthModule } from '../../modules/auth/auth.module';
import { IngestionGrpcModule } from '../grpc/ingestion-grpc.module';
import { CacheModule } from '../cache/cache.module';
import { CacheService } from '../cache/cache.service';

/**
 * The GraphQL surface
 *
 * **REST is not deprecated by it; both are permanent, with different jobs**
 *: REST stays the surface for commands, files and machine callers,
 * GraphQL is the read surface for the SPA. Saying so at the registration
 * prevents the slow drift where half the mutations live in one place and half in
 * the other with no rule.
 *
 * **A module again, after being inlined into `app.module.ts` and then brought
 * back — and the reversal is the point rather than churn.** It was inlined when
 * its whole body was `forRootAsync({ driver, imports: [ConfigModule,
 * AuthModule], inject: [ConfigService, AUTH_GRPC_CLIENT], useFactory })`: at
 * that size a module was a name to look up on the way to the thing you wanted.
 * The registration has since doubled — four imports, four injects — and it grows
 * again with every loader, because each new batch RPC is another channel the
 * factory must be handed. Seven symbols existed in `app.module.ts` for this one
 * entry and nothing else.
 *
 * So it now sits beside the rule, the plugin and the loaders it wires, exactly
 * as `cache.module.ts` sits beside `cache.service.ts`. The rule that decides
 * this is the same one everywhere in `common/`: a module is a wiring file, and
 * it lives next to what it wires.
 *
 * Resolvers are unaffected — they are providers of the feature modules whose
 * controllers they mirror, and `GraphQLModule` discovers them from the container
 * rather than from an import list. Nothing here knows what a ticket is.
 *
 * The class is `GraphqlApiModule` rather than `GraphqlModule` because the latter
 * differs from `@nestjs/graphql`'s `GraphQLModule` — imported directly below —
 * by capitalisation alone, and two symbols one shift-key apart in the same file
 * is a misread waiting to happen.
 */
@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      // **These are named HERE even though `AppModule` already imports them**,
      // and they have to be: `forRootAsync`'s factory resolves in the
      // GraphQLModule's OWN injector, which sees only what this `imports` array
      // names. A provider available to the enclosing module is not available to
      // it. The symptom otherwise is "Nest can't resolve dependencies of the
      // GqlModuleOptions", pointing at an argument index rather than at the
      // import that is missing.
      //
      // No new connections: each of these registers its channel once, and these
      // are the same instances every controller's client already holds.
      // `IngestionGrpcModule` is named despite being `@Global` for the same
      // reason — the documents loader dials through it.
      imports: [ConfigModule, AuthModule, IngestionGrpcModule, CacheModule],
      inject: [
        ConfigService,
        AUTH_GRPC_CLIENT,
        INGESTION_GRPC_CLIENT,
        CacheService,
      ],
      useFactory: getGraphqlConfig,
    }),
  ],
})
export class GraphqlApiModule {}
