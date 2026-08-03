import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  ORG_STATUS_TRANSITIONS,
  OrgStatus,
  SystemRoleName,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { pageRequest, superAdminContext } from '../utils/context';
import {
  addMember,
  createDeviceSession,
  createOrganization,
  seedTenantWithUser,
} from '../factories';
import { PlatformService } from '../../src/modules/platform/platform.service';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('§4.3 Platform (e2e)', () => {
  let fx: E2eFixture;
  let platform: PlatformService;
  let ctx: ReturnType<typeof superAdminContext>;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    platform = fx.moduleRef.get(PlatformService);
  });

  beforeEach(async () => {
    await fx.reset();
    const superAdmin = await fx.prisma.user.findFirstOrThrow({
      where: { isSuperAdmin: true },
    });
    ctx = superAdminContext(superAdmin.id);
  });

  afterAll(() => fx.close());

  // ------------------------------------------------------- tenant creation

  describe('createOrganization', () => {
    it('4. the tenant and its first Org Admin are created in ONE transaction', async () => {
      // Half of this succeeding is worse than both failing: an organization
      // nobody can administer, with no in-product path to a first admin.
      const result = await platform.createOrganization(
        {
          name: 'Contoso',
          slug: 'contoso',
          adminEmail: 'admin@contoso.test',
          adminFullName: 'Contoso Admin',
          allowedEmailDomains: [],
        },
        ctx,
      );

      const admin = await fx.prisma.user.findFirstOrThrow({
        where: { email: 'admin@contoso.test' },
        include: { roles: true },
      });
      expect(admin.organizationId).toBe(result.organization!.organization!.id);
      expect(admin.roles.map((r) => r.name)).toEqual([
        SystemRoleName.ORG_ADMIN,
      ]);
    });

    it('4b. a duplicate slug rolls the WHOLE thing back — no orphan admin', async () => {
      // The atomicity proof. A failure at the second write must not leave the
      // first one committed.
      await platform.createOrganization(
        {
          name: 'Contoso',
          slug: 'contoso',
          adminEmail: 'first@contoso.test',
          adminFullName: 'First',
          allowedEmailDomains: [],
        },
        ctx,
      );

      await expectRpc(
        platform.createOrganization(
          {
            name: 'Contoso Again',
            slug: 'contoso',
            adminEmail: 'second@contoso.test',
            adminFullName: 'Second',
            allowedEmailDomains: [],
          },
          ctx,
        ),
        status.ALREADY_EXISTS,
      );

      expect(
        await fx.prisma.user.count({ where: { email: 'second@contoso.test' } }),
      ).toBe(0);
      expect(
        await fx.prisma.organization.count({ where: { slug: 'contoso' } }),
      ).toBe(1);
    });

    it('4c. the grant moves roles.user_assigned', async () => {
      // Routed through RolesService rather than a bare `connect`, so the counter
      // that gates role deletion cannot drift on the platform path.
      const before = await fx.prisma.role.findFirstOrThrow({
        where: { name: SystemRoleName.ORG_ADMIN, organizationId: null },
      });

      await platform.createOrganization(
        {
          name: 'Counted',
          slug: 'counted',
          adminEmail: 'admin@counted.test',
          adminFullName: 'Counted Admin',
          allowedEmailDomains: [],
        },
        ctx,
      );

      const after = await fx.prisma.role.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after.userAssigned).toBe(before.userAssigned + 1);
    });

    it('a new tenant starts PENDING_ONBOARDING with usable quotas', async () => {
      // Absent quota fields must take the schema default rather than 0 — a
      // tenant created with zero seats could never be used.
      const result = await platform.createOrganization(
        {
          name: 'Defaults',
          slug: 'defaults',
          adminEmail: 'admin@defaults.test',
          adminFullName: 'Admin',
          allowedEmailDomains: [],
        },
        ctx,
      );

      const org = result.organization!.organization!;
      expect(org.status).toBe(OrgStatus.PENDING_ONBOARDING);
      expect(org.maxAgentSeats).toBeGreaterThan(0);
    });

    // ---------------------------------------------------- the lifecycle machine
  });

  describe('setOrganizationStatus', () => {
    it('2. every status transition is legal or 409 — the full 4x4 matrix', async () => {
      // Table-driven over every combination, so a future edit to
      // ORG_STATUS_TRANSITIONS is checked in both directions rather than only for
      // the cases someone remembered to write.
      const all = Object.values(OrgStatus);

      for (const from of all) {
        for (const to of all) {
          const org = await createOrganization(fx.prisma, { status: from });
          const legal = ORG_STATUS_TRANSITIONS[from].includes(to);

          if (legal) {
            const result = await platform.setOrganizationStatus(
              { organizationId: org.id, status: to, reason: 'matrix test' },
              ctx,
            );
            expect(result.organization!.status).toBe(to);
          } else {
            await expectRpc(
              platform.setOrganizationStatus(
                { organizationId: org.id, status: to, reason: 'matrix test' },
                ctx,
              ),
              status.ABORTED,
            );
            const unchanged = await fx.prisma.organization.findUniqueOrThrow({
              where: { id: org.id },
            });
            expect(unchanged.status).toBe(from);
          }
        }
      }
    });

    it('2b. a status outside the enum is INVALID_ARGUMENT, not ABORTED', async () => {
      // Different failure, different code: ABORTED means "legal value, wrong
      // moment" and a client may retry it; this one will never work.
      const org = await createOrganization(fx.prisma, {
        status: OrgStatus.ACTIVE,
      });

      await expectRpc(
        platform.setOrganizationStatus(
          { organizationId: org.id, status: 'NONSENSE', reason: 'x' },
          ctx,
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('2c. freezing revokes every session in that tenant, immediately', async () => {
      // Losing access is immediate; regaining it needs no session surgery, which
      // is why only the FROZEN branch does this.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.ACTIVE },
      });
      const other = await addMember(fx.prisma, t.org.id);
      await createDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, other.id);

      await platform.setOrganizationStatus(
        { organizationId: t.org.id, status: OrgStatus.FROZEN, reason: 'abuse' },
        ctx,
      );

      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: { in: [t.user.id, other.id] } },
        }),
      ).toBe(0);
    });

    it('2d. unfreezing does NOT touch sessions', async () => {
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.FROZEN },
      });
      await createDeviceSession(fx.prisma, t.user.id);

      await platform.setOrganizationStatus(
        {
          organizationId: t.org.id,
          status: OrgStatus.ACTIVE,
          reason: 'resolved',
        },
        ctx,
      );

      expect(
        await fx.prisma.deviceSession.count({ where: { userId: t.user.id } }),
      ).toBe(1);
    });

    it('2e. freezing another tenant leaves this one signed in', async () => {
      const frozen = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.ACTIVE },
      });
      const untouched = await seedTenantWithUser(fx.prisma);
      await createDeviceSession(fx.prisma, untouched.user.id);

      await platform.setOrganizationStatus(
        {
          organizationId: frozen.org.id,
          status: OrgStatus.FROZEN,
          reason: 'abuse',
        },
        ctx,
      );

      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: untouched.user.id },
        }),
      ).toBe(1);
    });

    // ------------------------------------------------------------------ quotas
  });

  describe('updateOrganization / resetBillingCycle', () => {
    it('the platform CAN change quotas — the thing the tenant endpoint may not', async () => {
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 10 },
      });

      const result = await platform.updateOrganization(
        { organizationId: t.org.id, maxAgentSeats: 100 },
        ctx,
      );

      expect(result.organization!.maxAgentSeats).toBe(100);
    });

    it('resetting the billing cycle moves the metering window forward', async () => {
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { billingCycleStart: new Date('2020-01-01T00:00:00Z') },
      });

      await platform.resetBillingCycle({ organizationId: t.org.id }, ctx);

      const org = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: t.org.id },
      });
      expect(org.billingCycleStart.getFullYear()).toBeGreaterThan(2020);
    });

    // ------------------------------------------------------- offboard / restore
  });

  describe('offboardOrganization / restoreOrganization', () => {
    it('offboarding soft-deletes the tenant and restore brings it back', async () => {
      const t = await seedTenantWithUser(fx.prisma);

      await platform.offboardOrganization(
        { organizationId: t.org.id, reason: 'churned' },
        ctx,
      );
      expect(
        (
          await fx.prisma.organization.findUniqueOrThrow({
            where: { id: t.org.id },
          })
        ).deletedAt,
      ).not.toBeNull();

      await platform.restoreOrganization({ organizationId: t.org.id }, ctx);
      expect(
        (
          await fx.prisma.organization.findUniqueOrThrow({
            where: { id: t.org.id },
          })
        ).deletedAt,
      ).toBeNull();
    });

    it('a deleted tenant is hidden from the list unless asked for', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      await platform.offboardOrganization(
        { organizationId: t.org.id, reason: 'churned' },
        ctx,
      );

      const hidden = await platform.listOrganizations({
        page: pageRequest(),
        includeDeleted: false,
        status: '',
      });
      const shown = await platform.listOrganizations({
        page: pageRequest(),
        includeDeleted: true,
        status: '',
      });

      expect(hidden.items.map((i) => i.organization!.id)).not.toContain(
        t.org.id,
      );
      expect(shown.items.map((i) => i.organization!.id)).toContain(t.org.id);
    });

    // --------------------------------------------------------- cross-tenant read
  });

  describe('listUsers', () => {
    it('5. cross-tenant user search carries the tenant on every row', async () => {
      // Without it a Super Admin looking at "alice@example.com" in a list of
      // three identical rows cannot tell which customer they are about to act on.
      const a = await seedTenantWithUser(fx.prisma);
      const b = await seedTenantWithUser(fx.prisma);

      const list = await platform.listUsers({
        page: pageRequest(),
        organizationId: '',
        includeDeleted: false,
      });

      const rows = list.items.filter((i) =>
        [a.user.id, b.user.id].includes(i.user!.id),
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.organizationName).toBeTruthy();
      }
      expect(rows.map((r) => r.organizationName).sort()).toEqual(
        [a.org.name, b.org.name].sort(),
      );
    });

    it('the platform sees across tenants; a tenant service never would', async () => {
      await seedTenantWithUser(fx.prisma);
      await seedTenantWithUser(fx.prisma);
      await seedTenantWithUser(fx.prisma);

      const list = await platform.listUsers({
        page: pageRequest(),
        organizationId: '',
        includeDeleted: false,
      });

      const orgIds = new Set(
        list.items.map((i) => i.user!.organizationId).filter(Boolean),
      );
      expect(orgIds.size).toBe(3);
    });

    // ------------------------------------------------------------ global roles
  });

  describe('createGlobalRole', () => {
    it('a platform-created role is GLOBAL and a system role', async () => {
      const created = await platform.createGlobalRole(
        {
          name: 'Auditor',
          description: 'Reads audit trails everywhere',
          permissionCodes: ['audit.read'],
        },
        ctx,
      );

      const row = await fx.prisma.role.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.organizationId).toBeNull();
      expect(row.isSystemRole).toBe(true);
    });

    it('a duplicate global role name is a 409', async () => {
      // `roles_global_name_key` is partial on `organization_id IS NULL` —
      // Postgres does not treat NULLs as equal, so the composite @@unique cannot
      // catch this on its own.
      await expectRpc(
        platform.createGlobalRole(
          {
            name: SystemRoleName.ORG_ADMIN,
            description: '',
            permissionCodes: [],
          },
          ctx,
        ),
        status.ALREADY_EXISTS,
      );
    });

    // ----------------------------------------------------------------- metrics
  });

  describe('getMetrics', () => {
    it('metrics count tenants by status and seats across the platform', async () => {
      await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.ACTIVE, maxAgentSeats: 10 },
      });
      await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.FROZEN, maxAgentSeats: 5 },
      });

      const metrics = await platform.getMetrics();

      expect(metrics.totalOrganizations).toBe(2);
      expect(metrics.seatsAllocated).toBe(15);
      // A map keyed by status, not a list of {status, count} pairs — a status
      // with no tenants is simply absent rather than reported as a zero.
      expect(metrics.organizationsByStatus).toMatchObject({
        [OrgStatus.ACTIVE]: 1,
        [OrgStatus.FROZEN]: 1,
      });
    });

    // ------------------------------------------------------------------- audit
  });

  describe('audit + getOrganization', () => {
    it('3. every platform write records organizationId: null', async () => {
      // A platform act belongs to the platform, not to the customer it touched
      // (RDM §1.7) — filing it under the tenant would put an operator action in
      // that customer's own audit trail.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.ACTIVE },
      });

      fx.audit.record.mockClear();

      await platform.createOrganization(
        {
          name: 'Audited',
          slug: 'audited',
          adminEmail: 'admin@audited.test',
          adminFullName: 'Admin',
          allowedEmailDomains: [],
        },
        ctx,
      );
      await platform.updateOrganization(
        { organizationId: t.org.id, maxAgentSeats: 42 },
        ctx,
      );
      await platform.setOrganizationStatus(
        { organizationId: t.org.id, status: OrgStatus.FROZEN, reason: 'test' },
        ctx,
      );
      await platform.resetBillingCycle({ organizationId: t.org.id }, ctx);
      await platform.offboardOrganization(
        { organizationId: t.org.id, reason: 'test' },
        ctx,
      );
      await platform.restoreOrganization({ organizationId: t.org.id }, ctx);
      await platform.createGlobalRole(
        { name: 'Audited Role', description: '', permissionCodes: [] },
        ctx,
      );

      expect(fx.audit.record.mock.calls.length).toBeGreaterThanOrEqual(7);
      for (const [, event] of fx.audit.record.mock.calls) {
        expect(event).toHaveProperty('organizationId', null);
      }
    });

    it('an unknown organization id is NOT_FOUND', async () => {
      await expectRpc(
        platform.getOrganization({
          organizationId: '00000000-0000-4000-8000-000000000000',
        }),
        status.NOT_FOUND,
      );
    });
  });
});
