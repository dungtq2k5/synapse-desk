import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { InvitationStatus, OrgStatus } from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { memberContext, superAdminContext } from '../utils/context';
import {
  addMember,
  createDeviceSession,
  createInvitation,
  seedTenantWithUser,
} from '../factories';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('Organizations (e2e)', () => {
  let fx: E2eFixture;
  let organizations: OrganizationsService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    organizations = fx.moduleRef.get(OrganizationsService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  const ctx = (t: { user: { id: string; organizationId: string | null } }) =>
    memberContext(t.user, [
      'organization.read',
      'organization.update',
      'organization.delete',
    ]);

  describe('getCurrentOrganization', () => {
    it('1. the tenant is resolved from the caller context, never from the request', async () => {
      // There is no path or body parameter to spoof — the shape of the RPC is
      // the guarantee. This test pins that: two tenants, the same call, and each
      // caller sees only their own.
      const a = await seedTenantWithUser(fx.prisma);
      const b = await seedTenantWithUser(fx.prisma);

      await expect(
        organizations.getCurrentOrganization(ctx(a)),
      ).resolves.toMatchObject({ id: a.org.id });
      await expect(
        organizations.getCurrentOrganization(ctx(b)),
      ).resolves.toMatchObject({ id: b.org.id });
    });

    it('2. a Super Admin gets FAILED_PRECONDITION, not a 500', async () => {
      // `organizationId` is null for a platform operator, so "your organization"
      // is not a question with an answer. Reaching into the query with a null and
      // crashing would be the alternative.
      const superAdmin = await fx.prisma.user.findFirstOrThrow({
        where: { isSuperAdmin: true },
      });

      await expectRpc(
        organizations.getCurrentOrganization(superAdminContext(superAdmin.id)),
        status.FAILED_PRECONDITION,
      );
    });
  });

  describe('updateOrganizationSettings', () => {
    it('3. enabling enforce_two_factor does not lock out an unenrolled admin', async () => {
      // The setting is written, and the account keeps working — the door out is
      // the enrolment challenge (see the two-factor suite), not an exemption here.
      const t = await seedTenantWithUser(fx.prisma);

      const result = await organizations.updateOrganizationSettings(
        {
          enforceTwoFactor: true,
          allowedEmailDomains: [],
          replaceAllowedEmailDomains: false,
        },
        ctx(t),
      );

      expect(result.enforceTwoFactor).toBe(true);
      const admin = await fx.prisma.user.findUniqueOrThrow({
        where: { id: t.user.id },
      });
      expect(admin.isLocked).toBe(false);
      expect(admin.isTwoFactorEnabled).toBe(false);
    });

    it('3b. a policy change tells the tenant admins', async () => {
      // The recipients are resolved from ROLE grants, not from the caller's token
      // — the point is to tell everyone who can undo the change, not to echo it
      // back to whoever made it. So the fixture's role must actually hold
      // `organization.update`; putting it only in the caller context would find
      // nobody and the test would assert on an empty loop.
      const t = await seedTenantWithUser(fx.prisma, {
        permissionCodes: ['organization.update'],
      });

      await organizations.updateOrganizationSettings(
        {
          enforceTwoFactor: true,
          allowedEmailDomains: [],
          replaceAllowedEmailDomains: false,
        },
        ctx(t),
      );

      expect(fx.notifications.sendEmail).toHaveBeenCalled();
    });

    it('4. a free-mail domain WARNS, it does not block the write', async () => {
      // The list of public providers can never be exhaustive, so treating it as
      // authoritative would block legitimate niche providers while still missing
      // others. A warning an admin reads is worth more than a blocklist that
      // pretends.
      const t = await seedTenantWithUser(fx.prisma);

      const result = await organizations.updateOrganizationSettings(
        {
          allowedEmailDomains: ['gmail.com'],
          replaceAllowedEmailDomains: true,
        },
        ctx(t),
      );

      expect(result.publicDomainWarnings.length).toBeGreaterThan(0);
      expect(result.allowedEmailDomains).toContain('gmail.com');
    });

    it('4b. a malformed domain IS rejected — a warning is not a free pass', async () => {
      const t = await seedTenantWithUser(fx.prisma);

      await expectRpc(
        organizations.updateOrganizationSettings(
          {
            allowedEmailDomains: ['not a domain'],
            replaceAllowedEmailDomains: true,
          },
          ctx(t),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('4c. omitting the replace flag leaves the domains alone', async () => {
      // A repeated field arrives as `[]` whether the caller sent an empty list or
      // omitted it. Without the explicit flag, every settings PATCH would wipe
      // the domain allowlist as a side effect.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { allowedEmailDomains: ['keepme.test'] },
      });

      const result = await organizations.updateOrganizationSettings(
        {
          enforceTwoFactor: true,
          allowedEmailDomains: [],
          replaceAllowedEmailDomains: false,
        },
        ctx(t),
      );

      expect(result.allowedEmailDomains).toEqual(['keepme.test']);
    });
  });

  describe('updateOrganization', () => {
    it('quotas are NOT settable from the tenant-facing update', async () => {
      // A tenant raising its own seat limit is the whole billing model gone.
      // Proven by the SHAPE: there is no field for it, so the only assertion
      // available is that the stored value is untouched by a full profile update.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 10 },
      });

      await organizations.updateOrganization({ name: 'Renamed Co' }, ctx(t));

      const org = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: t.org.id },
      });
      expect(org.maxAgentSeats).toBe(10);
      expect(org.name).toBe('Renamed Co');
    });
  });

  describe('completeOnboarding / getOnboarding', () => {
    it('5. completing onboarding from any other status is a 409', async () => {
      // It must not double as a way to un-suspend or un-freeze a tenant.
      for (const from of [
        OrgStatus.ACTIVE,
        OrgStatus.SUSPENDED_PAST_DUE,
        OrgStatus.FROZEN,
      ]) {
        const t = await seedTenantWithUser(fx.prisma, {
          organization: { status: from },
        });

        await expectRpc(
          organizations.completeOnboarding({}, ctx(t)),
          status.ABORTED,
        );

        const unchanged = await fx.prisma.organization.findUniqueOrThrow({
          where: { id: t.org.id },
        });
        expect(unchanged.status).toBe(from);
      }
    });

    it('5b. completing onboarding from PENDING_ONBOARDING activates the tenant', async () => {
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.PENDING_ONBOARDING },
      });

      const result = await organizations.completeOnboarding({}, ctx(t));

      expect(result.status).toBe(OrgStatus.ACTIVE);
    });
  });

  describe('getOrganizationUsage / seatsInUse', () => {
    it('6. usage seats and the invitation seat gate count identically', async () => {
      // The parity check the remaining-work doc calls out by name.
      // `seatsInUse()` is now a single function owned by this service, and both
      // callers go through it — this test is what stops a future edit
      // reintroducing a second definition, which is how an invite gets rejected
      // by a counter the usage page says has room.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 10 },
      });
      await addMember(fx.prisma, t.org.id);
      await addMember(fx.prisma, t.org.id);
      await createInvitation(fx.prisma, t.org.id);
      await createInvitation(fx.prisma, t.org.id);

      const usage = await organizations.getOrganizationUsage(ctx(t));
      const direct = await organizations.seatsInUse(fx.prisma, t.org.id);

      // 3 active members (the seeded admin + two) + 2 pending invitations.
      expect(direct).toBe(5);
      expect(usage.seats!.used).toBe(direct);
      expect(usage.seats!.limit).toBe(10);
    });

    it('6b. a pending invitation reserves a seat; an expired or accepted one does not', async () => {
      // Counting only active users would let an admin send 50 invites against 10
      // seats and blow the quota the moment they were accepted. Expiry is what
      // releases the reservation.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 10 },
      });

      const baseline = await organizations.seatsInUse(fx.prisma, t.org.id);

      await createInvitation(fx.prisma, t.org.id);
      expect(await organizations.seatsInUse(fx.prisma, t.org.id)).toBe(
        baseline + 1,
      );

      await createInvitation(fx.prisma, t.org.id, {
        expiresAt: new Date(Date.now() - 1000),
      });
      await createInvitation(fx.prisma, t.org.id, {
        status: InvitationStatus.REVOKED,
      });

      expect(await organizations.seatsInUse(fx.prisma, t.org.id)).toBe(
        baseline + 1,
      );
    });

    it('6c. a soft-deleted member frees their seat', async () => {
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 10 },
      });
      const leaver = await addMember(fx.prisma, t.org.id);

      const before = await organizations.seatsInUse(fx.prisma, t.org.id);
      await fx.prisma.user.update({
        where: { id: leaver.id },
        data: { deletedAt: new Date() },
      });

      expect(await organizations.seatsInUse(fx.prisma, t.org.id)).toBe(
        before - 1,
      );
    });

    it('6d. the meters for domains that do not exist report unavailable, not zero', async () => {
      // A zero reads as "you have used nothing", which is a claim we cannot make
      // when the service that would measure it has not been built.
      const t = await seedTenantWithUser(fx.prisma);

      const usage = await organizations.getOrganizationUsage(ctx(t));

      expect(usage.storage!.available).toBe(false);
      expect(usage.storage!.used).toBeFalsy();
      expect(usage.storage!.unavailableReason).toBeTruthy();
      expect(usage.aiTokens!.available).toBe(false);
      expect(usage.aiTokens!.unavailableReason).toBeTruthy();
    });
  });

  describe('deleteOrganization (offboarding)', () => {
    it('7. offboarding freezes the tenant and revokes every member session', async () => {
      // Access must stop at the moment of the request rather than whenever each
      // access token happens to expire.
      const t = await seedTenantWithUser(fx.prisma);
      const other = await addMember(fx.prisma, t.org.id);
      await createDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, other.id);
      await createDeviceSession(fx.prisma, other.id);

      const result = await organizations.deleteOrganization(
        { reason: 'Moving to a competitor' },
        ctx(t),
      );

      expect(result.revokedSessionCount).toBe(3);

      const org = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: t.org.id },
      });
      // FROZEN rather than a `deleted_at` stamp: the row must stay resolvable for
      // the platform to finalise or reverse.
      expect(org.status).toBe(OrgStatus.FROZEN);

      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: { in: [t.user.id, other.id] } },
        }),
      ).toBe(0);
    });

    it("7b. offboarding does not touch another tenant's sessions", async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedTenantWithUser(fx.prisma);
      await createDeviceSession(fx.prisma, theirs.user.id);

      await organizations.deleteOrganization({ reason: 'done' }, ctx(mine));

      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: theirs.user.id },
        }),
      ).toBe(1);
    });
  });

  describe('getOnboarding', () => {
    it('the onboarding checklist is derived live, not stored', async () => {
      // A stored checklist drifts the moment someone deletes the department they
      // just created, and then shows a tick beside something no longer true.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.PENDING_ONBOARDING },
      });

      const before = await organizations.getOnboarding(ctx(t));

      await fx.prisma.department.deleteMany({
        where: { organizationId: t.org.id },
      });

      const after = await organizations.getOnboarding(ctx(t));

      expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
    });
  });

  describe('getOrganizationStatus', () => {
    it('the status lookup reports deletion separately from status', async () => {
      // Collapsing them would hide an offboarded tenant whose status still reads
      // ACTIVE.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.ACTIVE },
      });

      await expect(
        organizations.getOrganizationStatus({ organizationId: t.org.id }),
      ).resolves.toEqual({ status: OrgStatus.ACTIVE, deleted: false });

      await fx.prisma.organization.update({
        where: { id: t.org.id },
        data: { deletedAt: new Date() },
      });

      await expect(
        organizations.getOrganizationStatus({ organizationId: t.org.id }),
      ).resolves.toEqual({ status: OrgStatus.ACTIVE, deleted: true });
    });

    it('an unknown organization id is NOT_FOUND, so the gate can fail closed', async () => {
      await expectRpc(
        organizations.getOrganizationStatus({
          organizationId: '00000000-0000-4000-8000-000000000000',
        }),
        status.NOT_FOUND,
      );
    });
  });

  describe('updateOrganization — validation', () => {
    it('an invalid slug is rejected before it reaches the database', async () => {
      const t = await seedTenantWithUser(fx.prisma);

      await expectRpc(
        organizations.updateOrganization({ slug: 'Not A Slug!' }, ctx(t)),
        status.INVALID_ARGUMENT,
      );
    });
  });
});
