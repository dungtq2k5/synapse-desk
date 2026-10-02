/**
 * @file **A path parameter that names an id refuses a value that is not a UUID**,
 * before any peer is called.
 *
 * Node parses these with `ParseUUIDPipe` (166 uses), so `GET /departments/nope`
 * is a 400. A gateway that takes the id as a plain string forwards `nope` to the
 * peer and returns whatever the peer makes of it (a 404, a 500, or, with nothing
 * programmed, a 501), and no other row notices: every other row sends a real id.
 *
 * **Generated from the document**: every operation with a path parameter named
 * `id` or `<something>Id`. The document types them as bare strings, so the
 * selection is by name and the rows say what Node does with each; a parameter
 * Node deliberately does not parse as a UUID is listed in {@link NOT_A_UUID}
 * with the reason, never silently skipped.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sign } from 'jsonwebtoken';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, REPO_ROOT, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

type Row = [method: string, path: string, parameter: string];

/** Path parameters named like an id that Node does NOT parse as a UUID, by `METHOD path name`. */
const NOT_A_UUID = new Set<string>([]);

/**
 * The (route, parameter) pairs the Java gateway does not yet refuse, MEASURED from
 * a full run of these rows on Java: 95 of 120. 92 forward the value to the peer
 * (which owns no UUID check: no service validates an id, and every id column is
 * `@db.Uuid`) and 3 answer 500 at the gateway (the invitations routes, where
 * `UUID.fromString` throws). They are the progress bar for this work and shrink to
 * empty; rows in the set are reported skipped for Java through
 * `SKIPPED_FOR_JAVA`, never silently, and the other 25 run on Java today.
 */
const NOT_YET_REFUSED = new Set<string>([
  'DELETE /api/v1/attachments/{id} id',
  'DELETE /api/v1/auth/sessions/{id}/trust id',
  'DELETE /api/v1/auth/sessions/{id} id',
  'DELETE /api/v1/departments/{id}/members/{userId} id',
  'DELETE /api/v1/departments/{id}/members/{userId} userId',
  'DELETE /api/v1/departments/{id} id',
  'DELETE /api/v1/documents/flags/{flagId} flagId',
  'DELETE /api/v1/documents/{id} id',
  'DELETE /api/v1/ingestion-jobs/{id} id',
  'DELETE /api/v1/messages/{messageId}/feedback messageId',
  'DELETE /api/v1/notifications/devices/{id} id',
  'DELETE /api/v1/platform/plans/{id} id',
  'DELETE /api/v1/roles/{id}/users/{userId} id',
  'DELETE /api/v1/roles/{id}/users/{userId} userId',
  'DELETE /api/v1/roles/{id} id',
  'DELETE /api/v1/tickets/{id}/assign id',
  'DELETE /api/v1/tickets/{id} id',
  'DELETE /api/v1/tickets/{ticketId}/messages/{messageId} messageId',
  'DELETE /api/v1/tickets/{ticketId}/messages/{messageId} ticketId',
  'DELETE /api/v1/users/invitations/{id} id',
  'DELETE /api/v1/users/{id} id',
  'DELETE /api/v1/users/{userId}/sessions userId',
  'DELETE /api/v1/webhook-endpoints/{id} id',
  'GET /api/v1/analytics/export/{id} id',
  'GET /api/v1/attachments/{id}/download id',
  'GET /api/v1/audit-logs/export/{id} id',
  'GET /api/v1/chat/conversations/{id}/messages id',
  'GET /api/v1/chat/conversations/{id} id',
  'GET /api/v1/departments/{id}/members id',
  'GET /api/v1/departments/{id} id',
  'GET /api/v1/documents/flags/{flagId} flagId',
  'GET /api/v1/documents/{id}/chunks/{chunkId} chunkId',
  'GET /api/v1/documents/{id}/chunks/{chunkId} id',
  'GET /api/v1/documents/{id}/chunks id',
  'GET /api/v1/documents/{id}/departments id',
  'GET /api/v1/documents/{id}/download id',
  'GET /api/v1/documents/{id}/ingestion-jobs id',
  'GET /api/v1/documents/{id} id',
  'GET /api/v1/ingestion-jobs/{id} id',
  'GET /api/v1/knowledge/articles/{id} id',
  'GET /api/v1/messages/{messageId}/feedback messageId',
  'GET /api/v1/platform/organizations/{id} id',
  'GET /api/v1/platform/plans/{id} id',
  'GET /api/v1/roles/{id} id',
  'GET /api/v1/tickets/export/{id} id',
  'GET /api/v1/tickets/{id}/assignments id',
  'GET /api/v1/tickets/{id}/history id',
  'GET /api/v1/tickets/{id}/similar id',
  'GET /api/v1/tickets/{id} id',
  'GET /api/v1/tickets/{ticketId}/ai/summary ticketId',
  'GET /api/v1/tickets/{ticketId}/messages/{messageId}/attachments messageId',
  'GET /api/v1/tickets/{ticketId}/messages/{messageId}/attachments ticketId',
  'GET /api/v1/tickets/{ticketId}/messages ticketId',
  'GET /api/v1/users/invitations/{id} id',
  'GET /api/v1/users/{id}/permissions id',
  'GET /api/v1/users/{id} id',
  'GET /api/v1/users/{userId}/sessions userId',
  'GET /api/v1/webhook-endpoints/{id}/deliveries id',
  'GET /api/v1/webhook-endpoints/{id} id',
  'PATCH /api/v1/departments/{id} id',
  'PATCH /api/v1/documents/{id} id',
  'PATCH /api/v1/platform/organizations/{id} id',
  'PATCH /api/v1/platform/plans/{id} id',
  'PATCH /api/v1/roles/{id} id',
  'PATCH /api/v1/tickets/{id} id',
  'PATCH /api/v1/users/{id} id',
  'PATCH /api/v1/webhook-endpoints/{id} id',
  'POST /api/v1/chat/conversations/{id}/escalate id',
  'POST /api/v1/departments/{id}/restore id',
  'POST /api/v1/documents/flags/{flagId}/dismiss flagId',
  'POST /api/v1/documents/flags/{flagId}/fixed flagId',
  'POST /api/v1/documents/flags/{flagId}/replaced flagId',
  'POST /api/v1/documents/{id}/reindex id',
  'POST /api/v1/documents/{id}/restore id',
  'POST /api/v1/ingestion-jobs/{id}/retry id',
  'POST /api/v1/notifications/{id}/archive id',
  'POST /api/v1/notifications/{id}/read id',
  'POST /api/v1/platform/organizations/{id}/restore id',
  'POST /api/v1/platform/plans/{id}/apply id',
  'POST /api/v1/tickets/{id}/close id',
  'POST /api/v1/tickets/{id}/escalate id',
  'POST /api/v1/tickets/{id}/read id',
  'POST /api/v1/tickets/{id}/reopen id',
  'POST /api/v1/tickets/{id}/resolve id',
  'POST /api/v1/tickets/{id}/restore id',
  'POST /api/v1/tickets/{ticketId}/ai/classify ticketId',
  'POST /api/v1/tickets/{ticketId}/ai/draft ticketId',
  'POST /api/v1/tickets/{ticketId}/ai/suggestions ticketId',
  'POST /api/v1/tickets/{ticketId}/ai/summary ticketId',
  'POST /api/v1/users/invitations/{id}/resend id',
  'POST /api/v1/users/{id}/2fa/reset id',
  'POST /api/v1/users/{id}/restore id',
  'POST /api/v1/users/{id}/unlock id',
  'POST /api/v1/webhook-endpoints/{id}/rotate-secret id',
  'POST /api/v1/webhook-endpoints/{id}/test id',
]);

const SOME_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function rows(): Row[] {
  const document = JSON.parse(
    readFileSync(join(REPO_ROOT, 'docs/reference/openapi.json'), 'utf8'),
  ) as {
    paths: Record<
      string,
      Record<string, { parameters?: { name: string; in: string }[] }>
    >;
  };
  const found: Row[] = [];

  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const parameter of operation.parameters ?? []) {
        if (parameter.in !== 'path' || !/^(id|\w+Id)$/u.test(parameter.name)) {
          continue;
        }
        found.push([method.toUpperCase(), path, parameter.name]);
      }
    }
  }

  return found;
}

describe('path parameters that name an id', () => {
  let gateway: Gateway;
  let peers: Peers;

  const headers = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: SOME_ID,
        organizationId: null,
        isSuperAdmin: true,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => peers.reset());

  const reached = () =>
    Object.values({
      auth: peers.auth,
      ticket: peers.ticket,
      ingestion: peers.ingestion,
      rag: peers.rag,
      notification: peers.notification,
    }).flatMap((peer) =>
      peer.calls().filter((call) => !call.method.endsWith('JobHealth')),
    );

  const refusesANonUuid = async (
    method: string,
    path: string,
    parameter: string,
  ) => {
    const url = path
      .replace(`{${parameter}}`, 'not-a-uuid')
      .replace(/\{\w+\}/gu, SOME_ID);
    // A body for the routes that take one, so the id is what is refused and not
    // a missing content type.
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? {}
      : undefined;
    const response = await new Session(gateway.baseUrl).request(method, url, {
      body,
      headers: headers(),
    });

    expect(response.status).toBe(400);
    expect(reached()).toEqual([]);
  };

  const checked = rows().filter((row) => !NOT_A_UUID.has(row.join(' ')));

  rowFor('Ops').each(
    checked.filter((row) => !NOT_YET_REFUSED.has(row.join(' '))),
  )(
    '**`%s %s` refuses a `%s` that is not a UUID, before any peer is called**',
    refusesANonUuid,
  );

  rowFor('Ops').each(
    checked.filter((row) => NOT_YET_REFUSED.has(row.join(' '))),
  )(
    '**`%s %s` refuses a `%s` that is not a UUID, before any peer is called** (Java does not refuse this yet)',
    refusesANonUuid,
  );
});
