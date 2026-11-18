/**
 * @file **The tenant comes from the token, and a miss looks like a miss**, on
 * every route that takes a resource id.
 *
 * The gateway holds no data, so it can't leak a row by itself. What it can get
 * wrong is the two halves of the services' tenant check:
 *
 * - **(a)** the tenant it forwards: `organization_id` metadata must be the
 *   token's organization on every call a route makes, never a value from the
 *   path. Every id in the path here IS another organization's id, so a gateway
 *   that read one would forward it;
 * - **(b)** the answer to a refusal: every peer answers `NOT_FOUND`, and every
 *   route must turn that into the same 404 body, so a row that exists in
 *   another tenant can't be told apart from one that doesn't.
 *
 * **Generated from the document**: every operation with a path parameter
 * named `id` or `<something>Id`, outside `/platform` (a Super Admin has no
 * tenant to forward). The services' own probe (`tenant-probe.e2e-spec.ts` in
 * each) holds the other side: that a wrong-tenant id IS a miss there.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';
import {
  allOperations,
  minimalValue,
  PERMISSION_CODES,
} from './request-bodies';

/** The caller's tenant, and another tenant whose id fills every path. */
const OWN = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';
const OTHER = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
const CALLER = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

/** Calls that aren't the route's own: the org-status gate and health probes. */
const NOT_THE_ROUTE = /GetOrganizationStatus|JobHealth$/u;

const rows = allOperations()
  .filter(
    (operation) =>
      !operation.path.includes('/platform/') &&
      /\{(id|\w+Id)\}/u.test(operation.path) &&
      !(Array.isArray(operation.security) && operation.security.length === 0),
  )
  .map((operation) => [operation.method, operation.path, operation] as const);

describe('the tenant on id-taking routes', () => {
  let gateway: Gateway;
  let peers: Peers;

  const headers = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: CALLER,
        organizationId: OWN,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: PERMISSION_CODES,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const all = () => [
    peers.auth,
    peers.ticket,
    peers.ingestion,
    peers.rag,
    peers.notification,
  ];

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
    for (const peer of all())
      peer.failByDefault(GrpcStatus.NOT_FOUND, 'No such thing');
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Ops').each(rows)(
    '**`%s %s`**: forwards the token’s tenant, never the path’s, and a peer’s NOT_FOUND is the one 404 body',
    async (
      method: string,
      path: string,
      operation: (typeof rows)[number][2],
    ) => {
      const url = `${API}${path.replace(/^\/api\/v1/u, '').replace(/\{\w+\}/gu, OTHER)}${
        operation.query ? `?${operation.query}` : ''
      }`;
      const response = await new Session(gateway.baseUrl).request(method, url, {
        body: operation.body ? minimalValue(operation.body) : undefined,
        headers: headers(),
      });

      const calls = all().flatMap((peer) =>
        peer.calls().filter((call) => !NOT_THE_ROUTE.test(call.method)),
      );
      // `path` and `timestamp` differ per route by design; the rest must not.
      const body = Object.fromEntries(
        Object.entries(response.body as Record<string, unknown>).filter(
          ([key]) => key !== 'path' && key !== 'timestamp',
        ),
      );

      expect({
        status: response.status,
        body,
        reachedAPeer: calls.length > 0,
        tenants: [
          ...new Set(calls.map((call) => call.metadata.organization_id)),
        ],
      }).toEqual({
        status: 404,
        body: { success: false, statusCode: 404, error: 'No such thing!' },
        reachedAPeer: true,
        tenants: [OWN],
      });
    },
  );
});
