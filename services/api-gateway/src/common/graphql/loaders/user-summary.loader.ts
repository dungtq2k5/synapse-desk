import type { ClientGrpc } from '@nestjs/microservices';
import {
  packRequestContext,
  USER_SERVICE_NAME,
  UserProjection,
  type UserServiceClient,
} from '@synapsedesk/grpc-proto';
import { BATCH_ID_LIMIT, type RequestContext } from '@synapsedesk/common';
import { firstValueFrom } from 'rxjs';
import { createCachedLoader } from './loaders.factory';
import { toUserSummaryResponseGqlDto } from '../../../modules/users/user.mapper';
import type { UserSummaryResponseGqlDto } from '../../../modules/users/dto/graphql/user-response.gql-dto';
import type { CacheService } from '../../cache/cache.service';
import { ENTITY_TTL_SECONDS, entityScope } from '../../config/cache.config';

/**
 * The users loader
 *
 * **50 tickets asking for `assignee { fullName }` becomes ONE gRPC call.**
 * Unbatched it is fifty concurrent calls into auth-service, which is also
 * serving every login in the system calls that an outage rather
 * than a missed optimisation, and it is triggered by a query string.
 *
 * **And now Redis in front of that**. A `UserSummary` is the ideal
 * thing to cache and that is not a coincidence: it is small, read on nearly
 * every edge in the schema, and changed by four handlers nobody calls often. It
 * is also shared across QUERIES — one cached user serves `Ticket.assignee`,
 * `TicketMessage.sender`, `Notification.actor` and `AgentStat.agent`, in any
 * query shape, for any client.
 */
export function createUserSummaryLoader(
  client: ClientGrpc,
  context: () => RequestContext,
  cache: CacheService,
) {
  const users = client.getService<UserServiceClient>(USER_SERVICE_NAME);

  return createCachedLoader<UserSummaryResponseGqlDto>({
    cache,
    organizationId: () => context().organizationId,
    scopeOf: (id) => entityScope('user', id),
    ttlSeconds: ENTITY_TTL_SECONDS,
    keyOf: (user) => user.id,
    // Never more than the RPC will accept. Without
    // this, one page of 100 tickets with two user edges is a 200-id batch that
    // the service refuses outright, and the whole column nulls.
    //
    // It bounds the RPC, not the cache read: a fully-cached batch of 200 makes
    // no call at all, and capping the Redis lookup would only re-introduce the
    // round trips the cache just removed.
    maxBatchSize: BATCH_ID_LIMIT,
    fetch: async (ids) => {
      const response = await firstValueFrom(
        users.listUsersByIds(
          {
            organizationId: context().organizationId ?? '',
            userIds: [...ids],
            // **`true`**. The notification caller wants "who can act
            // on this?"; a loader wants "who IS this?". A ticket assigned to
            // somebody locked this morning must still render their name, and
            // excluding them shows a blank where "Former employee" belongs.
            includeInactive: true,
            // No `email`, no quiet hours. Enforced at the WIRE rather than by a
            // mapper here: data the gateway never receives is data it cannot
            // leak.
            projection: UserProjection.USER_PROJECTION_SUMMARY,
          },
          packRequestContext(context()),
        ),
      );

      // The alignment moved INTO `createCachedLoader`, where it now has to hold
      // across a partial hit as well. Returning the rows is
      // all this function does.
      // Mapped HERE rather than in the resolvers: a loader that answers
      // proto forces all six `@ResolveField`s to map, and a routing layer
      // that maps is how two edges over one RPC drift apart.
      return response.summaries.map((summary) =>
        toUserSummaryResponseGqlDto(summary),
      );
    },
  });
}
