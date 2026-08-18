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
 * The GraphQL surface.
 *
 * **REST is not deprecated by it; both are permanent, with different jobs.**
 * REST stays the surface for commands, files and machine callers; GraphQL is
 * the read surface for the SPA. Stating that here is what prevents half the
 * mutations drifting into one and half into the other.
 *
 * Lives beside the rule, the plugin and the loaders it wires — a module is a
 * wiring file, and it sits next to what it wires.
 *
 * Resolvers are unaffected: they are providers of the feature modules whose
 * controllers they mirror, and `GraphQLModule` discovers them from the
 * container rather than from an import list. Nothing here knows what a ticket
 * is.
 *
 * The class is `GraphqlApiModule`, not `GraphqlModule`: the latter differs from
 * `@nestjs/graphql`'s `GraphQLModule` — imported below — by capitalization
 * alone, and two symbols one shift-key apart in one file is a misread waiting
 * to happen.
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
