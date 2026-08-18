import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import {
  fromProtoAuditAction,
  toProtoAuditAction,
  toProtoAuditResourceType,
  toProtoTimestamp,
  type ListAuditLogsRequest,
  type ProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditResourceType,
  compareAlphabetically,
} from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
  superAdminContext,
} from '../utils';
import { buildTenant, createAuditLog, TenantFixture } from '../factories';
import { AuditReadService } from '../../src/modules/audit/audit-read.service';

describe('Audit logs read API (e2e)', () => {
  let fx: E2eFixture;
  let audit: AuditReadService;

  let tenant: TenantFixture;

  const auditor = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'audit.read',
    ]);

  /**
   * Takes DOMAIN values and converts, so call sites still read
   * `{ action: AuditAction.USER_CREATED }` rather than a proto member name.
   *
   * The two enumerated filters default to UNSPECIFIED — which is what the empty
   * strings here used to stand in for, and what test 5 below is about.
   */
  const listRequest = (
    overrides: Partial<{
      action: AuditAction;
      userId: string;
      resourceType: AuditResourceType;
      resourceId: string;
      from: ProtoTimestamp;
      to: ProtoTimestamp;
      platformScope: boolean;
    }> = {},
  ): ListAuditLogsRequest => ({
    page: pageRequest(),
    action: toProtoAuditAction(overrides.action),
    userId: overrides.userId ?? '',
    resourceType: toProtoAuditResourceType(overrides.resourceType),
    resourceId: overrides.resourceId ?? '',
    from: overrides.from,
    to: overrides.to,
    platformScope: overrides.platformScope ?? false,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    audit = fx.moduleRef.get(AuditReadService);
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  // ------------------------------------------------------------- scoping

  describe('scoping', () => {
    it('1. is TENANT-scoped', async () => {
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        action: AuditAction.USER_CREATED,
      });
      await createAuditLog(fx.prisma, {
        organizationId: faker.string.uuid(),
        action: AuditAction.USER_CREATED,
      });

      const { items } = await audit.listAuditLogs(listRequest(), auditor());

      expect(items).toHaveLength(1);
      expect(items[0].organizationId).toBe(tenant.organizationId);
    });

    it('2. NEVER mixes platform rows into a tenant’s view', async () => {
      // `organization_id IS NULL` events belong to the platform, not to any
      // customer. Folding them in would show one customer's admin things that
      // happened to other customers.
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        action: AuditAction.USER_CREATED,
      });
      await createAuditLog(fx.prisma, {
        organizationId: null,
        action: 'PLATFORM_ORGANIZATION_SUSPENDED',
      });

      const { items } = await audit.listAuditLogs(listRequest(), auditor());

      expect(items).toHaveLength(1);
      expect(fromProtoAuditAction(items[0].action)).toBe(
        AuditAction.USER_CREATED,
      );
    });

    it('3. shows the platform view ONLY platform rows', async () => {
      // The other direction, and just as important: a Super Admin reviewing
      // platform activity must not have a customer's rows folded in.
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        action: AuditAction.USER_CREATED,
      });
      await createAuditLog(fx.prisma, {
        organizationId: null,
        action: 'PLATFORM_ORGANIZATION_SUSPENDED',
      });

      const { items } = await audit.listAuditLogs(
        listRequest({ platformScope: true }),
        superAdminContext(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].organizationId).toBeUndefined();
    });

    it('4. REFUSES the platform scope to a tenant member', async () => {
      await createAuditLog(fx.prisma, { organizationId: null });

      await expectRpc(
        audit.listAuditLogs(listRequest({ platformScope: true }), auditor()),
        status.PERMISSION_DENIED,
      );
    });

    it('5. REFUSES a Super Admin the tenant view — they have no tenant', async () => {
      // Their context carries a null organization, so "their own tenant trail"
      // does not exist. They must ask for the platform view explicitly rather
      // than silently receiving every row.
      //
      // FAILED_PRECONDITION (-> 400) rather than 403: they are permitted to
      // read audit logs, but not through a route that needs a tenant they do
      // not have. It is the request that is wrong, not the caller.
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
      });

      await expectRpc(
        audit.listAuditLogs(listRequest(), superAdminContext()),
        status.FAILED_PRECONDITION,
      );
    });
  });

  // ------------------------------------------------------------ filtering

  describe('filtering', () => {
    const seed = async () => {
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        action: AuditAction.USER_CREATED,
        userId: tenant.userId,
        resourceType: AuditResourceType.USER,
        createdAt: new Date('2026-01-15T00:00:00.000Z'),
      });
      // **`TICKET_ASSIGNED` / `Ticket` used to be seeded here, and no producer
      // anywhere emits either.** Every `audit.record` publisher passes an
      // `AuditAction` member, and `AuditResourceType` has no TICKET — so these
      // rows were testing the filter against values the table can never hold.
      // The behaviour under test is unchanged; only the fixtures are real now.
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        action: AuditAction.ROLE_CREATED,
        userId: tenant.agentId,
        resourceType: AuditResourceType.ROLE,
        createdAt: new Date('2026-06-15T00:00:00.000Z'),
      });
    };

    it('1. filters by ACTION', async () => {
      await seed();

      const { items } = await audit.listAuditLogs(
        listRequest({ action: AuditAction.ROLE_CREATED }),
        auditor(),
      );

      expect(items).toHaveLength(1);
      expect(fromProtoAuditAction(items[0].action)).toBe(
        AuditAction.ROLE_CREATED,
      );
    });

    it('2. filters by USER', async () => {
      await seed();

      const { items } = await audit.listAuditLogs(
        listRequest({ userId: tenant.userId }),
        auditor(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].userId).toBe(tenant.userId);
    });

    it('3. filters by RESOURCE TYPE', async () => {
      await seed();

      const { items } = await audit.listAuditLogs(
        listRequest({ resourceType: AuditResourceType.ROLE }),
        auditor(),
      );

      expect(items).toHaveLength(1);
    });

    it('4. filters by a date RANGE, inclusive of the end', async () => {
      await seed();

      const { items } = await audit.listAuditLogs(
        listRequest({
          from: toProtoTimestamp(new Date('2026-06-01T00:00:00.000Z')),
          to: toProtoTimestamp(new Date('2026-06-15T00:00:00.000Z')),
        }),
        auditor(),
      );

      expect(items).toHaveLength(1);
      expect(fromProtoAuditAction(items[0].action)).toBe(
        AuditAction.ROLE_CREATED,
      );
    });

    it('5. treats UNSPECIFIED as "no filter"', async () => {
      // proto3 scalars have no null, so an omitted enum filter arrives as the
      // zero value. Reading that as a literal member would return nothing.
      await seed();

      const { items } = await audit.listAuditLogs(listRequest(), auditor());

      expect(items).toHaveLength(2);
    });

    it('6. counts with the SAME filter it lists with', async () => {
      await seed();

      const { items, meta } = await audit.listAuditLogs(
        listRequest({ action: AuditAction.USER_CREATED }),
        auditor(),
      );

      expect(meta!.totalItems).toBe(items.length);
      expect(meta!.totalItems).toBe(1);
    });
  });

  // -------------------------------------------------------------- actions

  describe('listAuditActions', () => {
    it('1. returns only actions that ACTUALLY occurred', async () => {
      // Not the full enum. A dropdown offering `PLATFORM_*` to a customer who
      // can never trigger it is full of guaranteed-empty options, which trains
      // people to distrust the filter.
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        action: AuditAction.USER_CREATED,
      });
      await createAuditLog(fx.prisma, {
        organizationId: null,
        action: 'PLATFORM_ORGANIZATION_SUSPENDED',
      });

      const { actions } = await audit.listAuditActions(
        { platformScope: false },
        auditor(),
      );

      expect(actions.map((action) => fromProtoAuditAction(action))).toEqual([
        AuditAction.USER_CREATED,
      ]);
    });

    it('2. DEDUPLICATES repeated actions', async () => {
      for (let i = 0; i < 3; i++) {
        await createAuditLog(fx.prisma, {
          organizationId: tenant.organizationId,
          action: AuditAction.USER_CREATED,
        });
      }

      const { actions } = await audit.listAuditActions(
        { platformScope: false },
        auditor(),
      );

      expect(actions.map((action) => fromProtoAuditAction(action))).toEqual([
        AuditAction.USER_CREATED,
      ]);
    });

    it('3. sorts alphabetically, so the dropdown order is stable', async () => {
      // Three real members, chosen so alphabetical order and ENUM order
      // disagree — `USER_CREATED` is 14 and `ROLE_CREATED` is 10, so a service
      // that sorted the numbers instead would put them the other way round.
      // That is the regression this test exists for now that the wire carries
      // integers rather than names.
      for (const action of [
        AuditAction.USER_CREATED,
        AuditAction.DEPARTMENT_CREATED,
        AuditAction.ROLE_CREATED,
      ]) {
        await createAuditLog(fx.prisma, {
          organizationId: tenant.organizationId,
          action,
        });
      }

      const { actions } = await audit.listAuditActions(
        { platformScope: false },
        auditor(),
      );

      expect(actions.map((action) => fromProtoAuditAction(action))).toEqual([
        AuditAction.DEPARTMENT_CREATED,
        AuditAction.ROLE_CREATED,
        AuditAction.USER_CREATED,
      ]);
    });

    it('4. returns an EMPTY list for a tenant with no activity', async () => {
      const { actions } = await audit.listAuditActions(
        { platformScope: false },
        auditor(buildTenant()),
      );

      expect(actions).toEqual([]);
    });

    it('5. REFUSES the platform scope to a tenant member', async () => {
      await expectRpc(
        audit.listAuditActions({ platformScope: true }, auditor()),
        status.PERMISSION_DENIED,
      );
    });
  });

  // ------------------------------------------------------------- metadata

  describe('metadata', () => {
    it('1. carries the JSONB diff across as a JSON string', async () => {
      // A typed proto message could only be a `map<string, string>`, which would
      // flatten every nested value in the before/after diff.
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        metadata: { before: { status: 'OPEN' }, after: { status: 'CLOSED' } },
      });

      const { items } = await audit.listAuditLogs(listRequest(), auditor());

      expect(JSON.parse(items[0].metadata)).toEqual({
        before: { status: 'OPEN' },
        after: { status: 'CLOSED' },
      });
    });

    it('2. serializes an EMPTY metadata as {}, never as the string "null"', async () => {
      await createAuditLog(fx.prisma, {
        organizationId: tenant.organizationId,
        metadata: {},
      });

      const { items } = await audit.listAuditLogs(listRequest(), auditor());

      expect(items[0].metadata).toBe('{}');
    });
  });

  // --------------------------------------------------------- no write path

  describe('the contract has NO write path', () => {
    it('1. exposes no create/update/delete method on the service', () => {
      // The absence, asserted. `audit_logs` is populated by one NATS consumer
      // and by nothing else — a trail anybody can write to is a trail nobody
      // can rely on. This fails the moment somebody adds a write method,
      // which is the point at which they should have to justify it.
      const methods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(audit),
      ).filter((name) => name !== 'constructor');

      expect([...methods].sort(compareAlphabetically)).toEqual([
        'listAuditActions',
        'listAuditLogs',
        'scope',
      ]);
    });
  });
});
