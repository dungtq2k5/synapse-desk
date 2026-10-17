/**
 * @file `AuditLogsApi` (tenant-scoped, permission-gated) and
 * `PlatformAuditLogsApi` (platform-scoped, `SuperAdminGuard`-only — the
 * first purely-super-admin route in this port, no permission code
 * involved). Both share ticket-service's `AuditService`, distinguished by
 * `platformScope` on the wire; the export pair reuses the analytics export
 * lifecycle rather than a second one.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('audit-logs', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'ffffffff-4444-4444-8444-ffffffffffff';
  const USER = 'ffffffff-5555-4555-8555-ffffffffffff';

  const headers = (permissionCodes: string[] = []) => ({
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

  const superAdminHeaders = () => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
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

  const wireLog = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    organizationId: ORGANIZATION,
    userId: USER,
    action: 'AUDIT_ACTION_USER_CREATED',
    resourceType: 'AUDIT_RESOURCE_TYPE_USER',
    metadata: '{}',
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
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

  rowFor('Audit Logs')(
    '**`list` forwards the action filter and requires `audit.read`**',
    async () => {
      peers.ticket.on('AuditService/ListAuditLogs').reply({
        items: [wireLog('log-1')],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/audit-logs?action=USER_CREATED`,
        headers(['audit.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ id: 'log-1', action: 'USER_CREATED' }] },
      });
      const [call] = peers.ticket.calls('AuditService/ListAuditLogs');
      expect(call.request).toMatchObject({ action: 14, platformScope: false }); // AUDIT_ACTION_USER_CREATED
    },
  );

  rowFor('Audit Logs')(
    '**`list` refuses an unrecognized `action` rather than silently matching everything**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/audit-logs?action=SOME_FUTURE_ACTION`,
        headers(['audit.read']),
      );

      expect(response.status).toBe(400);
      expect(peers.ticket.calls('AuditService/ListAuditLogs')).toHaveLength(0);
    },
  );

  rowFor('Audit Logs')(
    '**`list` refuses `searchTerm`**, a filter it does not take, rather than answering unfiltered',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/audit-logs?searchTerm=x`,
        headers(['audit.read']),
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'property searchTerm should not exist!',
      });
      expect(peers.ticket.calls('AuditService/ListAuditLogs')).toHaveLength(0);
    },
  );

  rowFor('Audit Logs')('**`listActions` requires `audit.read`**', async () => {
    peers.ticket
      .on('AuditService/ListAuditActions')
      .reply({ actions: ['AUDIT_ACTION_USER_CREATED'] });

    const response = await new Session(gateway.baseUrl).get(
      `${API}/audit-logs/actions`,
      headers(['audit.read']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { actions: ['USER_CREATED'] },
    });
  });

  rowFor('Audit Logs')(
    '**`createExport` needs `audit.export`, forwards the AUDIT_LOG kind, answers 202**',
    async () => {
      peers.ticket.on('AnalyticsService/CreateExport').reply({
        id: '11111111-2222-4222-8222-111111111111',
        status: 1,
        kind: 4, // EXPORT_KIND_AUDIT_LOG
        createdAt: { seconds: 1_756_684_800, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/audit-logs/export`,
        { from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' },
        headers(['audit.export']),
      );

      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ data: { kind: 'AUDIT_LOG' } });
      const [call] = peers.ticket.calls('AnalyticsService/CreateExport');
      expect(call.request).toMatchObject({ kind: 4 });
    },
  );

  rowFor('Audit Logs')(
    '**`createExport` refuses a malformed `from` date — the dropped ISO-8601 check**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/audit-logs/export`,
        { from: 'not-a-date', to: '2024-01-31T23:59:59Z' },
        headers(['audit.export']),
      );

      expect(response.status).toBe(400);
      expect(peers.ticket.calls('AnalyticsService/CreateExport')).toHaveLength(
        0,
      );
    },
  );

  rowFor('Audit Logs')(
    '**`createExport` refuses without `audit.export`**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/audit-logs/export`,
        { from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' },
        headers([]),
      );

      expect(response.status).toBe(403);
      expect(peers.ticket.calls('AnalyticsService/CreateExport')).toHaveLength(
        0,
      );
    },
  );

  rowFor('Audit Logs')('**`getExport` needs `audit.export`**', async () => {
    const id = '22222222-3333-4333-8333-222222222222';
    peers.ticket.on('AnalyticsService/GetExport').reply({
      id,
      status: 2,
      kind: 4,
      downloadUrl: 'https://storage.example/audit-export.csv',
      createdAt: { seconds: 1_756_684_800, nanos: 0 },
    });

    const response = await new Session(gateway.baseUrl).get(
      `${API}/audit-logs/export/${id}`,
      headers(['audit.export']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { downloadUrl: 'https://storage.example/audit-export.csv' },
    });
  });

  rowFor('PlatformAuditLogs')(
    '**`list` refuses anyone who is not a super admin, before dialing the peer**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/audit-logs`,
        headers(['audit.read']),
      );

      expect(response.status).toBe(403);
      expect(peers.ticket.calls('AuditService/ListAuditLogs')).toHaveLength(0);
    },
  );

  rowFor('PlatformAuditLogs')(
    '**`list` succeeds for a super admin, with `platformScope` set**',
    async () => {
      peers.ticket.on('AuditService/ListAuditLogs').reply({
        items: [
          wireLog('log-2', {
            organizationId: undefined,
            action: 'AUDIT_ACTION_PLATFORM_ORGANIZATION_CREATED',
          }),
        ],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/audit-logs`,
        superAdminHeaders(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ id: 'log-2' }] },
      });
      const [call] = peers.ticket.calls('AuditService/ListAuditLogs');
      expect(call.request).toMatchObject({ platformScope: true });
    },
  );

  rowFor('PlatformAuditLogs')(
    '**`listActions` refuses anyone who is not a super admin**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/platform/audit-logs/actions`,
        headers([]),
      );

      expect(response.status).toBe(403);
      expect(peers.ticket.calls('AuditService/ListAuditActions')).toHaveLength(
        0,
      );
    },
  );
});
