/**
 * @file `PermissionsApi` — the smallest REST interface in Phase A's
 * remaining batch: one cached, read-only route. Its cache key is shared
 * with the GraphQL permission-catalogue loader (`permission-catalogue.loader.ts`),
 * so this row proves the REST route writes and reads that key.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('permissions', () => {
  let gateway: Gateway;
  let peers: Peers;

  // Not the common `11111111-…`/`22222222-…` fixture ids: this route's cache
  // entry is DELIBERATELY shared with the GraphQL permission-catalogue
  // loader (see the file docblock), and `graphql-roles-users.contract-spec.ts`
  // already reads/writes that same `(organization, "permissions")` key under
  // those ids. Reusing them here would make this row's "exactly one call"
  // assertion a coin flip on which file's suite runs first in this
  // `maxWorkers: 1` sweep — gap 43's mechanism, on the one route built to
  // share a cache key on purpose.
  const ORGANIZATION = '99999999-1111-4111-8111-999999999999';
  const USER = '99999999-2222-4222-8222-999999999999';

  const cookie = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
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

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Permissions')(
    '**requires `role.read`, and a second call within the TTL never reaches the peer**',
    async () => {
      peers.auth.on('RoleService/ListPermissions').reply({
        items: [
          {
            id: 'p1',
            code: 'ticket.read.all',
            name: 'Read all tickets',
            group: 'ticket',
            isRetired: false,
          },
        ],
      });

      const session = new Session(gateway.baseUrl);
      const first = await session.get(
        `${API}/permissions`,
        cookie(['role.read']),
      );
      const second = await session.get(
        `${API}/permissions`,
        cookie(['role.read']),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(
        (first.body as { data: { code: string; isRetired: boolean }[] }).data,
      ).toEqual([
        {
          id: 'p1',
          code: 'ticket.read.all',
          name: 'Read all tickets',
          group: 'ticket',
          isRetired: false,
        },
      ]);
      expect(peers.auth.calls('RoleService/ListPermissions')).toHaveLength(1);
    },
  );

  rowFor('Permissions')(
    '**refuses without `role.read`, before the peer is called**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/permissions`,
        cookie([]),
      );

      expect(response.status).toBe(403);
      expect(peers.auth.calls('RoleService/ListPermissions')).toHaveLength(0);
    },
  );
});
