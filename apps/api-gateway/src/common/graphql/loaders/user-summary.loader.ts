import type { ClientGrpc } from '@nestjs/microservices';
import {
  packRequestContext,
  USER_SERVICE_NAME,
  UserProjection,
  type UserServiceClient,
  type UserSummary,
} from '@synapsedesk/grpc-proto';
import { BATCH_ID_LIMIT, type RequestContext } from '@synapsedesk/common';
import { firstValueFrom } from 'rxjs';
import { alignToKeys, createLoader } from './loaders.factory';

/**
 * The users loader — 27-doc §2, §3.
 *
 * **50 tickets asking for `assignee { fullName }` becomes ONE gRPC call.**
 * Unbatched it is fifty concurrent calls into auth-service, which is also
 * serving every login in the system — 25-doc §2 calls that an outage rather
 * than a missed optimisation, and it is triggered by a query string.
 */
export function createUserSummaryLoader(
  client: ClientGrpc,
  context: RequestContext,
) {
  const users = client.getService<UserServiceClient>(USER_SERVICE_NAME);

  return createLoader<string, UserSummary>(
    async (ids) => {
      const response = await firstValueFrom(
        users.listUsersByIds(
          {
            organizationId: context.organizationId ?? '',
            userIds: [...ids],
            // **`true`** — 27-doc §3. The notification caller wants "who can act
            // on this?"; a loader wants "who IS this?". A ticket assigned to
            // somebody locked this morning must still render their name, and
            // excluding them shows a blank where "Former employee" belongs.
            includeInactive: true,
            // No `email`, no quiet hours. Enforced at the WIRE rather than by a
            // mapper here: data the gateway never receives is data it cannot
            // leak (25-doc §4).
            projection: UserProjection.USER_PROJECTION_SUMMARY,
          },
          packRequestContext(context),
        ),
      );

      // **Mapped from the KEYS, never from the response** — 27-doc §2. This is
      // the line that stops the misattribution bug: a database answers
      // `WHERE id IN ('c','a','b')` as a, b, c, and handing that straight back
      // renders the wrong user against every ticket, with no error anywhere.
      return alignToKeys(ids, response.summaries, (user) => user.userId);
    },
    {
      // Never more than the RPC will accept — 27-doc §1, property 5. Without
      // this, one page of 100 tickets with two user edges is a 200-id batch that
      // the service refuses outright, and the whole column nulls.
      maxBatchSize: BATCH_ID_LIMIT,
    },
  );
}
