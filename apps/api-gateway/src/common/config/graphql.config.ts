import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Request, Response } from 'express';
import { NodeEnv } from '@synapsedesk/common';
import { MAX_QUERY_COMPLEXITY, MAX_QUERY_DEPTH } from './graphql-limits.config';
import { depthLimitRule } from '../graphql/depth-limit.rule';
import { queryCostPlugin } from '../graphql/query-cost.plugin';
import {
  createLoaders,
  type GqlContext,
} from '../graphql/loaders/loaders.factory';
import { CacheService } from '../cache/cache.service';

/**
 * Where the generated SDL is written — and it is COMMITTED.
 *
 * A generated file in source control looks redundant until the first breaking
 * change: with it, removing a field is a red line in a diff somebody reviews;
 * without it, it is a client failing in staging a week later. `sortSchema`
 * keeps that diff meaningful rather than reordered noise.
 *
 * **Resolved from THIS file, not from `process.cwd()`.** It used to be
 * `join(process.cwd(), 'apps/api-gateway/src/schema.gql')`, which is correct
 * only when the process starts at the repo root. Booting from the workspace
 * directory — which `nest start` inside `apps/api-gateway` does — made that
 * `apps/api-gateway/apps/api-gateway/src/schema.gql`, and the app duly created
 * it. A second, stale schema then sat one directory down, invisible to the
 * drift test because that test only ever looks at the real path.
 *
 * `__dirname` is `src/common/config`, so two levels up is `src/`. Under ts-jest
 * that is the real source tree, which is what the drift test needs; in a built
 * image it lands beside the compiled sources instead of fabricating a nested
 * path inside the repo.
 */
export const SCHEMA_PATH = join(__dirname, '../../schema.gql');

/**
 * The Apollo driver options — the GraphQL twin of `getThrottlerConfig`.
 *
 * **A factory here rather than an inline `useFactory` in the module**, for the
 * reason the throttler already demonstrates: what a module does is wire things
 * together, and a fifty-line options object inside a decorator argument buries
 * every policy decision in the wiring. Extracted, the module is a five-line
 * statement of "GraphQL is configured by this", and the questions people
 * actually arrive with — is introspection on in prod, what is the depth cap,
 * where do loaders come from — are answerable in one file that reads as prose.
 *
 * The injected arguments are the whole reason this cannot be a plain constant:
 * `NODE_ENV` decides introspection, and the two gRPC channels are what the
 * per-request loaders batch through.
 *
 * Three things it sets up, in the order they matter:
 *
 * 1. **Cost limits before any resolver runs**. A validation rule
 *      and a complexity plugin, both firing before execution — a limit that
 *      fires after the fan-out is a log line, not a limit.
 *   2. **The context factory**, the only place a DataLoader is ever constructed
 *. Loaders are a cache keyed by id and an id carries no tenant,
 *      so where they are built is a security decision.
 * 3. **No envelope**. `TransformInterceptor` already bypasses for
 *      GraphQL and `AllHttpExceptionFilter` already re-throws so Apollo formats
 *      the error; this relies on both rather than re-deciding.
 */
export const getGraphqlConfig = (
  configService: ConfigService,
  authClient: ClientGrpc,
  ingestionClient: ClientGrpc,
  cache: CacheService,
): Omit<ApolloDriverConfig, 'driver'> => {
  const isProduction =
    configService.getOrThrow<NodeEnv>('NODE_ENV') === 'production';

  return {
    autoSchemaFile: SCHEMA_PATH,
    sortSchema: true,

    // **OFF in production** The schema is a map of the API: every
    // type, every field, every argument, handed to anyone who asks. Non-prod
    // keeps it, because that is where the tooling lives.
    introspection: !isProduction,
    // The landing page is a second, unnecessary surface; `/docs` already
    // documents the REST half and introspection serves any real IDE.
    playground: false,

    // **The one place loaders are constructed**
    //
    // `res` is passed through as well: the global throttler writes its limit
    // headers to it, and a context without one makes that fail and fail OPEN.
    // See `GqlContext`.
    context: ({ req, res }: { req: Request; res: Response }): GqlContext => ({
      req,
      res,
      // **A plain property, and the laziness is INSIDE the loaders** — see
      // `createLoaders`. Apollo clones the context with `Object.assign`, which
      // fires any getter at request start, so deferral cannot live here.
      loaders: createLoaders(req, {
        auth: authClient,
        ingestion: ingestionClient,
        // The entity cache the loaders read through Passed in
        // rather than injected into each loader, because a loader is built per
        // request by this factory and nothing here is in the DI graph.
        cache,
      }),
    }),

    // Runs during VALIDATION, before execution begins — so a query that is too
    // deep never reaches a resolver and never makes a gRPC call.
    validationRules: [depthLimitRule(MAX_QUERY_DEPTH)],
    plugins: [queryCostPlugin(MAX_QUERY_COMPLEXITY)],

    // Stack traces are internals. Apollo includes them by default outside
    // production, and this gateway's REST filter already strips them — one
    // transport leaking what the other carefully does not is the kind of
    // asymmetry nobody goes looking for.
    includeStacktraceInErrorResponses: false,
  };
};
