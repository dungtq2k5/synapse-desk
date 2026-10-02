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
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, REPO_ROOT, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

type Row = [method: string, path: string, parameter: string];

/** Path parameters named like an id that Node does NOT parse as a UUID, by `METHOD path name`. */
const NOT_A_UUID = new Set<string>([]);

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

  // These rows do NOT assert which 400 they got, unlike the enum rows (which require
  // the refusal to name its parameter): `ParseUUIDPipe`'s message ("Validation
  // failed (uuid is expected)") names no parameter, so there is nothing to assert.
  // The cause is pinned by construction instead: every OTHER path variable is a real
  // UUID, a body is sent where the route takes one, and the caller is a super admin
  // with no permission or tenant to refuse first.
  rowFor('Ops').each(rows().filter((row) => !NOT_A_UUID.has(row.join(' '))))(
    '**`%s %s` refuses a `%s` that is not a UUID, before any peer is called**',
    async (method: string, path: string, parameter: string) => {
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
    },
  );

  rowFor('Ops')(
    '**the permission check comes first: a caller without the permission is refused for THAT (403), whatever the id**',
    async () => {
      const tenantMember = {
        cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
          {
            sub: SOME_ID,
            organizationId: 'a0480000-0000-4000-8000-000000000048',
            isSuperAdmin: false,
            departmentIds: [],
            permissionCodes: [],
            isEmailVerified: true,
          },
          TEST_KEYS.access(),
          { algorithm: 'RS256', expiresIn: '15m' },
        )}`,
      };
      peers.auth.on('OrganizationService/GetOrganizationStatus').always({
        status: toProtoOrgStatus(OrgStatus.ACTIVE),
        deleted: false,
      });

      const response = await new Session(gateway.baseUrl).get(
        '/api/v1/departments/not-a-uuid',
        tenantMember,
      );

      expect(response.status).toBe(403);
    },
  );

  rowFor('Ops')(
    '**a malformed id is a counted request, under its route template: Node refuses it inside its metrics interceptor**',
    async () => {
      const total = async (): Promise<number> =>
        (await (await fetch(`${gateway.metricsUrl}/metrics`)).text())
          .split('\n')
          .filter((line) => line.startsWith('http_requests_total{'))
          .reduce((sum, line) => sum + Number(line.split(' ').pop()), 0);
      const before = await total();

      const response = await new Session(gateway.baseUrl).get(
        '/api/v1/departments/not-a-uuid',
        headers(),
      );

      expect(response.status).toBe(400);
      expect(await total()).toBe(before + 1);
    },
  );
});
