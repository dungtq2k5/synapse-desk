/**
 * @file `grpc_client_duration_seconds{peer, code}` on `/metrics`.
 *
 * Every gateway -> peer call is timed under the PEER it reached and the status it
 * ended with. The `code` label is the status name — `OK`, `NOT_FOUND`,
 * `UNAVAILABLE` — and there is no `method` label. A dashboard reads these values,
 * so a change to how they are named would break the panel and nothing else would
 * notice.
 *
 * Each row measures a DELTA against the peer's own call record: "recorded once
 * per call" is only checkable against what the peer actually saw.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('the gRPC client metric on /metrics', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  const USER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const DEPARTMENT = 'cccccccc-1111-4111-8111-cccccccccccc';

  const headers = (
    permissionCodes: string[] = [],
    claims: Record<string, unknown> = {},
  ) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
        ...claims,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireDepartment = (id: string) => ({
    id,
    name: 'Support',
    description: 'Front line',
    memberCount: 3,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
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
    // The lifecycle gate asks for the tenant's status on a cache miss; without a
    // standing answer the row would depend on what an earlier suite left cached.
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  /** `peer|code` -> count, for the histogram's `_count` samples. */
  const countsOf = (text: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const line of text.split('\n')) {
      const match =
        /^grpc_client_duration_seconds_count\{([^}]*)\}\s+(\S+)$/u.exec(line);
      if (!match) continue;
      const labels = Object.fromEntries(
        [...match[1].matchAll(/(\w+)="([^"]*)"/gu)].map(([, k, v]) => [k, v]),
      );
      // The label SET is part of the contract: peer and code, nothing else.
      expect(Object.keys(labels).sort()).toEqual(['code', 'peer']);
      counts[`${labels.peer}|${labels.code}`] = Number(match[2]);
    }

    return counts;
  };

  const moved = async (action: () => Promise<unknown>) => {
    const scrape = async () =>
      countsOf(await (await fetch(`${gateway.metricsUrl}/metrics`)).text());
    const before = await scrape();
    await action();
    const after = await scrape();

    return Object.fromEntries(
      Object.entries(after)
        .map(([key, value]) => [key, value - (before[key] ?? 0)] as const)
        .filter(([, increase]) => increase > 0),
    );
  };

  const get = (path: string, permission: string) =>
    new Session(gateway.baseUrl).get(`${API}${path}`, headers([permission]));

  rowFor('Ops')(
    "**every call the request makes is recorded once, under its peer and `OK` — the lifecycle gate's status call included**",
    async () => {
      peers.auth
        .on('DepartmentService/GetDepartment')
        .reply(wireDepartment(DEPARTMENT));

      const seen = peers.auth.calls().length;
      const result = await moved(async () => {
        expect(
          (await get(`/departments/${DEPARTMENT}`, 'department.read')).status,
        ).toBe(200);
      });
      // The request's own calls: the background job-health poll is the gateway's,
      // is unprogrammed here, and is counted under its own code.
      const made = peers.auth
        .calls()
        .slice(seen)
        .filter((call) => !call.method.endsWith('JobHealth'));

      // Counted against the peer's own record, so a call the gateway made and
      // never timed (or timed twice) is a difference, not a coincidence. The
      // status call is in `made` whenever the tenant was not cached.
      expect(made.map((call) => call.method)).toContain(
        'DepartmentService/GetDepartment',
      );
      expect(result['auth-service|OK']).toBe(made.length);
    },
  );

  rowFor('Ops')(
    "**the lifecycle gate's status call is timed: a tenant the cache has not seen costs one `OrganizationService/GetOrganizationStatus`, and one `auth-service|OK` sample**",
    async () => {
      const stranger = 'a0460000-0000-4000-8000-000000000046';
      peers.auth
        .on('DepartmentService/GetDepartment')
        .reply(wireDepartment(DEPARTMENT));

      const seen = peers.auth.calls().length;
      const result = await moved(async () => {
        const response = await new Session(gateway.baseUrl).get(
          `${API}/departments/${DEPARTMENT}`,
          headers(['department.read'], { organizationId: stranger }),
        );
        expect(response.status).toBe(200);
      });

      const methods = peers.auth
        .calls()
        .slice(seen)
        .map((call) => call.method);
      expect(methods).toContain('OrganizationService/GetOrganizationStatus');
      // Both the status call and the department call, not the department alone.
      expect(result['auth-service|OK']).toBe(
        methods.filter((method) => !method.endsWith('JobHealth')).length,
      );
      expect(result['auth-service|OK']).toBeGreaterThanOrEqual(2);
    },
  );

  rowFor('Ops')(
    '**the job-health fan-out is counted against the peer each leg reached — a failing auth-service poll is `auth-service`, not `ticket-service`**',
    async () => {
      const seenPeers = async (): Promise<Set<string>> => {
        const text = await (
          await fetch(`${gateway.metricsUrl}/metrics`)
        ).text();

        return new Set(
          Object.keys(countsOf(text))
            .filter((key) => key.endsWith('|UNIMPLEMENTED'))
            .map((key) => key.split('|')[0]),
        );
      };

      // Unprogrammed in this suite, so every poll answers UNIMPLEMENTED.
      // Wait for the scheduler's poll rather than assume its timing.
      const deadline = Date.now() + 20_000;
      let found = await seenPeers();
      while (found.size < 4 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        found = await seenPeers();
      }

      expect([...found].sort()).toEqual([
        'auth-service',
        'ingestion-service',
        'notification-service',
        'ticket-service',
      ]);
    },
  );

  rowFor('Ops')(
    '**the peer label names the PROCESS reached: a ticket-service call is `ticket-service`, not `auth-service`**',
    async () => {
      peers.ticket.on('AuditService/ListAuditLogs').reply({
        items: [],
        meta: {
          totalItems: 0,
          itemCount: 0,
          itemsPerPage: 10,
          totalPages: 0,
          currentPage: 1,
        },
      });

      const result = await moved(async () => {
        expect((await get('/audit-logs', 'audit.read')).status).toBe(200);
      });

      expect(result['ticket-service|OK']).toBe(
        peers.ticket.calls('AuditService/ListAuditLogs').length,
      );
      expect(peers.ticket.calls('AuditService/ListAuditLogs')).toHaveLength(1);
    },
  );

  rowFor('Ops')(
    '**a failed call carries the status NAME as its `code` — `NOT_FOUND`, not `5`**',
    async () => {
      peers.auth
        .on('DepartmentService/GetDepartment')
        .fail(GrpcStatus.NOT_FOUND, 'No such department');

      const result = await moved(async () => {
        expect(
          (await get(`/departments/${DEPARTMENT}`, 'department.read')).status,
        ).toBe(404);
      });

      expect(result['auth-service|NOT_FOUND']).toBe(1);
      expect(Object.keys(result).some((key) => /\|\d+$/u.test(key))).toBe(
        false,
      );
    },
  );

  rowFor('Ops')(
    '**an unreachable peer is `UNAVAILABLE` — the failure an operator pages on**',
    async () => {
      peers.auth
        .on('DepartmentService/GetDepartment')
        .fail(GrpcStatus.UNAVAILABLE, 'down');

      const result = await moved(async () => {
        expect(
          (await get(`/departments/${DEPARTMENT}`, 'department.read')).status,
        ).toBe(503);
      });

      expect(result['auth-service|UNAVAILABLE']).toBe(1);
    },
  );
});
