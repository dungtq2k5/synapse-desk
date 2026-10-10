import type { ClientGrpc } from '@nestjs/microservices';
import {
  packRequestContext,
  ROLE_SERVICE_NAME,
  type RoleServiceClient,
} from '@synapsedesk/grpc-proto';
import { firstValueFrom } from 'rxjs';
import type { RequestContext } from '@synapsedesk/common';
import type { CacheService } from '../../cache/cache.service';
import { CACHE_SCOPES } from '../../config/cache.config';
import { createLoader } from './loaders.factory';
import { toPermissionResponseDtos } from '../../../modules/roles/role.mapper';
import type { PermissionResponseGqlDto } from '../../../modules/roles/dto/graphql/role-response.gql-dto';

/**
 * One hour, matching `GET /permissions` in `permissions.controller.ts`.
 *
 * Two SEPARATE entries under separate scopes, so neither TTL bounds the other —
 * but change both or neither anyway: they answer the same question, and a
 * mismatch means REST and GraphQL disagree about how stale the catalogue is.
 *
 * The hour's cost is inherited with it — a deploy that retires a permission code
 * leaves up to an hour of editors offering it, and the API refuses the grant
 * regardless.
 */
const PERMISSION_CATALOGUE_TTL_SECONDS = 60 * 60;

/**
 * The permission catalogue loader
 *
 * **Not keyed by permission id — keyed by TENANT, and always a batch of one.**
 * The catalogue is a single list per tenant, so this is a DataLoader used for
 * its per-request memo rather than for batching: a page of fifty roles each
 * resolving `permissions` makes ONE call, not fifty.
 *
 * That is the whole reason it exists. `Role.permissions` looks like it can call
 * `RolesService.listPermissions` directly — a service, not a gRPC client, so
 * `resolvers.spec.ts` permits it — and doing so is one call per role.
 *
 * **Redis behind the memo, under a scope of its own.** `CacheableInterceptor`
 * reads `switchToHttp().getRequest()` — an empty object under GraphQL — so it
 * returns early on every resolver and none of `GET /permissions`' caching
 * reaches here. This does its own `cache.wrap`.
 *
 * It deliberately does NOT share the REST route's key. That was the first
 * design and it was wrong: the interceptor stores the response ENVELOPE, this
 * stores the bare list, and a shared key means the second writer's shape is
 * misread by the first reader. Two entries per tenant is the cost of not
 * coupling a loader to the envelope's layout.
 *
 * The hour is inherited along with its documented cost: a deploy that retires a
 * code leaves up to an hour of editors offering it, and the API refuses the
 * grant regardless.
 */
export function createPermissionCatalogueLoader(
  client: ClientGrpc,
  context: () => RequestContext,
  cache: CacheService,
) {
  const roles = client.getService<RoleServiceClient>(ROLE_SERVICE_NAME);

  // Through `createLoader`, not `new DataLoader`: `resolvers.spec.ts` pins the
  // factory as the only place a loader is constructed, and it caught this file
  // doing it directly. The rule is worth more than the two lines it costs.
  return createLoader<string, PermissionResponseGqlDto[]>(
    async (organizationIds) => {
      const caller = context();

      const catalogue = await cache.wrap(
        {
          organizationId: caller.organizationId,
          // **Its own scope, not the REST route's.** An earlier version shared
          // `CACHE_SCOPES.permissions` so the two surfaces would warm one
          // entry. They cannot: `CacheableInterceptor` sits outside
          // `TransformInterceptor` and stores the whole response envelope,
          // while this stores the bare list, so whichever wrote first broke the
          // other. Caught by the e2e test that reads back what REST warmed.
          scope: CACHE_SCOPES.permissionsGraphql,
          // No params: the catalogue is per-tenant and takes no arguments.
          params: {},
        },
        PERMISSION_CATALOGUE_TTL_SECONDS,
        async () =>
          toPermissionResponseDtos(
            await firstValueFrom(
              roles.listPermissions({}, packRequestContext(caller)),
            ),
          ),
      );

      // One entry per requested key, which DataLoader requires. Every key in a
      // request is the same tenant, so this is the same list N times rather than
      // N lists.
      return organizationIds.map(() => catalogue);
    },
    // No `maxBatchSize`: the batch is bounded by the number of distinct tenants
    // in one request, which is one.
  );
}
