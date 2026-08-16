import { AuditAction } from '@synapsedesk/common';
import {
  AuditAction as ProtoAuditAction,
  AuditResourceType as ProtoAuditResourceType,
} from '@synapsedesk/grpc-proto';
import { of } from 'rxjs';
import { faker } from '@faker-js/faker';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { timestamp, wirePage } from '../fixtures/wire';

/**
 * §2.9 The audit trail at the HTTP boundary.
 *
 * Two things are under test and neither is a filter: that the PLATFORM view is
 * a different path with a different guard rather than a query flag, and that a
 * row whose metadata cannot be parsed does not take the whole page down.
 */
describe('§2.9 Audit logs at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  const wireLog = (overrides: Record<string, unknown> = {}) => ({
    id: faker.string.uuid(),
    organizationId: faker.string.uuid(),
    userId: faker.string.uuid(),
    action: ProtoAuditAction.AUDIT_ACTION_USER_CREATED,
    resourceType: ProtoAuditResourceType.AUDIT_RESOURCE_TYPE_USER,
    resourceId: faker.string.uuid(),
    ipAddress: '10.0.0.1', // NOSONAR
    userAgent: 'jest',
    metadata: '{}',
    createdAt: timestamp(),
    ...overrides,
  });

  describe('GET /audit-logs', () => {
    it('1. requires audit.read', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/audit-logs`);

      expect(res.status).toBe(403);
      expect(fx.stubs.audit.listAuditLogs).not.toHaveBeenCalled();
    });

    it('2. lists for an auditor', async () => {
      fx.stubs.audit.listAuditLogs.mockReturnValue(
        of({ items: [wireLog()], meta: wirePage([]).meta }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
    });

    it('3. REJECTS a platformScope query param outright', async () => {
      // The scope is part of the PATH, not a parameter, so `platformScope` is
      // simply not a field this DTO has — and `forbidNonWhitelisted` turns that
      // into a 400 rather than a silently ignored parameter.
      //
      // Refusing beats ignoring here. A caller who added the flag believed it
      // would do something; answering 200 with tenant rows would let them think
      // they were reading the platform trail and finding it empty.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs?platformScope=true`);

      expect(res.status).toBe(400);
      expect(fx.stubs.audit.listAuditLogs).not.toHaveBeenCalled();
    });

    it('4. sends platformScope FALSE from the tenant route', async () => {
      fx.stubs.audit.listAuditLogs.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app, { permissionCodes: ['audit.read'] }).get(
        `${API}/audit-logs`,
      );

      const [request] = fx.stubs.audit.listAuditLogs.mock.calls[0];
      expect(request.platformScope).toBe(false);
    });

    it('5. PARSES metadata back into an object', async () => {
      fx.stubs.audit.listAuditLogs.mockReturnValue(
        of({
          items: [
            wireLog({
              metadata: JSON.stringify({
                before: { status: 'OPEN' },
                after: { status: 'CLOSED' },
              }),
            }),
          ],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs`);

      expect(res.body.data.items[0].metadata).toEqual({
        before: { status: 'OPEN' },
        after: { status: 'CLOSED' },
      });
    });

    it('6. survives UNPARSEABLE metadata rather than 500ing the page', async () => {
      // The trail is what somebody reaches for when something has already gone
      // wrong. Failing the whole page because one row's diff is malformed takes
      // the tool away exactly when it is needed — and the rest of that row is
      // still perfectly readable.
      fx.stubs.audit.listAuditLogs.mockReturnValue(
        of({
          items: [wireLog({ metadata: '{not json' }), wireLog()],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items[0].metadata).toEqual({});
    });

    it('7. renders a PLATFORM row’s absent organizationId as null', async () => {
      fx.stubs.audit.listAuditLogs.mockReturnValue(
        of({
          items: [wireLog({ organizationId: undefined, userId: undefined })],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs`);

      expect(res.body.data.items[0]).toHaveProperty('organizationId', null);
      expect(res.body.data.items[0]).toHaveProperty('userId', null);
    });

    it('8. forwards ABSENT filters as UNSPECIFIED and empty strings', async () => {
      fx.stubs.audit.listAuditLogs.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app, { permissionCodes: ['audit.read'] }).get(
        `${API}/audit-logs`,
      );

      const [request] = fx.stubs.audit.listAuditLogs.mock.calls[0];
      // The enumerated filter goes as proto3's zero value, which is what the
      // empty string used to stand in for. `userId` is a uuid, not a
      // vocabulary, so it stays a string.
      expect(request.action).toBe(ProtoAuditAction.AUDIT_ACTION_UNSPECIFIED);
      expect(request.userId).toBe('');
    });

    it('9. **REJECTS an unknown action rather than dropping the filter**', async () => {
      // **This test used to assert the opposite**, and the reasoning behind it
      // was sound while `action` was a wire `string`: an unknown value reached
      // an equality filter and matched nothing, so forwarding it was honest and
      // a gateway enum would have 400'd a genuine event.
      //
      // The field is a proto enum now, so an unrecognized name converts to
      // UNSPECIFIED — and UNSPECIFIED means NO FILTER. Forwarding it would turn
      // `?action=SOME_FUTURE_ACTION` into "return everything", and a caller
      // reading that page as "these are the SOME_FUTURE_ACTION events" is a
      // wrong answer rather than an empty one.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs?action=SOME_FUTURE_ACTION`);

      expect(res.status).toBe(400);
      expect(fx.stubs.audit.listAuditLogs).not.toHaveBeenCalled();
    });

    it('10. REJECTS a non-UUID userId filter', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs?userId=not-a-uuid`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /audit-logs/actions', () => {
    it('1. does not collide with a future :id route', async () => {
      fx.stubs.audit.listAuditActions.mockReturnValue(
        of({ actions: [ProtoAuditAction.AUDIT_ACTION_USER_CREATED] }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      }).get(`${API}/audit-logs/actions`);

      expect(res.status).toBe(200);
      // The gateway converts back to NAMES for the client — the REST body
      // must never carry the wire's integers.
      expect(res.body.data).toEqual([AuditAction.USER_CREATED]);
      expect(fx.stubs.audit.listAuditLogs).not.toHaveBeenCalled();
    });

    it('2. requires audit.read', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/audit-logs/actions`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /platform/audit-logs', () => {
    it('1. is REFUSED to a tenant admin, however permissioned', async () => {
      // A separate guard, not a permission — `audit.read` in a tenant cannot
      // reach the platform trail no matter what else is granted alongside it.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read', 'analytics.read'],
      }).get(`${API}/platform/audit-logs`);

      expect(res.status).toBe(403);
      expect(fx.stubs.audit.listAuditLogs).not.toHaveBeenCalled();
    });

    it('2. sends platformScope true for a Super Admin', async () => {
      fx.stubs.audit.listAuditLogs.mockReturnValue(
        of({
          items: [wireLog({ organizationId: undefined })],
          meta: wirePage([]).meta,
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        isSuperAdmin: true,
        organizationId: null,
      }).get(`${API}/platform/audit-logs`);

      expect(res.status).toBe(200);
      const [request] = fx.stubs.audit.listAuditLogs.mock.calls[0];
      expect(request.platformScope).toBe(true);
    });

    it('3. exposes the actions list under the platform scope too', async () => {
      fx.stubs.audit.listAuditActions.mockReturnValue(
        // `PLATFORM_ORGANIZATION_SUSPENDED` was never a member; the status
        // change is recorded as PLATFORM_ORGANIZATION_STATUS_CHANGED.
        of({
          actions: [
            ProtoAuditAction.AUDIT_ACTION_PLATFORM_ORGANIZATION_STATUS_CHANGED,
          ],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        isSuperAdmin: true,
        organizationId: null,
      }).get(`${API}/platform/audit-logs/actions`);

      expect(res.status).toBe(200);
      const [request] = fx.stubs.audit.listAuditActions.mock.calls[0];
      expect(request.platformScope).toBe(true);
    });
  });

  describe('the surface is READ ONLY', () => {
    it('1. exposes no write verb on /audit-logs', async () => {
      // The absence, asserted at the boundary. There is no `CreateAuditLog`
      // message in the proto either — a trail anybody can write to is a trail
      // nobody can rely on.
      const client = authenticatedAgent(fx.app, {
        permissionCodes: ['audit.read'],
      });

      expect((await client.post(`${API}/audit-logs`).send({})).status).toBe(
        404,
      );
      expect((await client.patch(`${API}/audit-logs`).send({})).status).toBe(
        404,
      );
      expect((await client.delete(`${API}/audit-logs`)).status).toBe(404);
    });

    it('2. refuses an ANONYMOUS caller', async () => {
      const res = await anonymousAgent(fx.app).get(`${API}/audit-logs`);

      expect(res.status).toBe(401);
    });
  });
});
