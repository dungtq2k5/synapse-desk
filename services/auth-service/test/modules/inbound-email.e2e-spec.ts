import { generateInboundToken, SystemRoleName } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { seedTenantWithUser } from '../factories';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { UsersService } from '../../src/modules/users/users.service';

/**
 * The two RPCs inbound mail resolves through
 *
 * **The security half of the feature.** Everything downstream is a transport
 * detail; these two decide which tenant a stranger's email lands in and whether
 * it may create an account there.
 */
describe('Inbound email resolution (e2e)', () => {
  let fx: E2eFixture;
  let organizations: OrganizationsService;
  let users: UsersService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    organizations = fx.moduleRef.get(OrganizationsService);
    users = fx.moduleRef.get(UsersService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  // ------------------------------------------------- inbound token

  describe('resolving the tenant from the address token', () => {
    it('1. resolves the tenant that owns the token', async () => {
      const inboundToken = generateInboundToken();
      const tenant = await seedTenantWithUser(fx.prisma, {
        organization: { inboundToken },
      });

      await expect(
        organizations.resolveOrgByInboundToken({ inboundToken }),
      ).resolves.toMatchObject({ organizationId: tenant.org.id });
    });

    it('2. **a tenant with a NULL token cannot be addressed**', async () => {
      // Opt-in, proven. Without this the feature is "on for everybody" and the
      // only thing stopping mail is that nobody guessed an address.
      await seedTenantWithUser(fx.prisma, {
        organization: { inboundToken: null },
      });

      const resolved = await organizations.resolveOrgByInboundToken({
        inboundToken: '',
      });

      expect(resolved.organizationId).toBeUndefined();
    });

    it('3. **rotation stops the old address routing**', async () => {
      // The reason this is a column rather than the slug: an abused address can
      // be replaced without touching anything else.
      const original = generateInboundToken();
      const tenant = await seedTenantWithUser(fx.prisma, {
        organization: { inboundToken: original },
      });

      const rotated = generateInboundToken();
      await fx.prisma.organization.update({
        where: { id: tenant.org.id },
        data: { inboundToken: rotated },
      });

      expect(
        (
          await organizations.resolveOrgByInboundToken({
            inboundToken: original,
          })
        ).organizationId,
      ).toBeUndefined();
      expect(
        (
          await organizations.resolveOrgByInboundToken({
            inboundToken: rotated,
          })
        ).organizationId,
      ).toBe(tenant.org.id);
    });

    it('4. an unknown token is absent, not an exception', async () => {
      // The caller must be able to tell "unroutable" (drop, answer 200) from
      // "auth-service is down" (let the provider retry). An exception collapses
      // the two, and the mail is lost on the retry that would have saved it.
      await expect(
        organizations.resolveOrgByInboundToken({
          inboundToken: generateInboundToken(),
        }),
      ).resolves.toEqual(
        expect.objectContaining({ organizationId: undefined }),
      );
    });

    it('5. a soft-deleted tenant does not resolve', async () => {
      const inboundToken = generateInboundToken();
      const tenant = await seedTenantWithUser(fx.prisma, {
        organization: { inboundToken },
      });

      await fx.prisma.organization.update({
        where: { id: tenant.org.id },
        data: { deletedAt: new Date() },
      });

      expect(
        (await organizations.resolveOrgByInboundToken({ inboundToken }))
          .organizationId,
      ).toBeUndefined();
    });
  });

  // ------------------------------------------------- tenant resolution

  describe('resolving the sender within that tenant', () => {
    it('1. a known member authors as themselves', async () => {
      const tenant = await seedTenantWithUser(fx.prisma);

      await expect(
        users.resolveInboundSender({
          organizationId: tenant.org.id,
          email: tenant.user.email,
        }),
      ).resolves.toEqual({ userId: tenant.user.id, created: false });
    });

    it('2. **an allowed-domain stranger becomes an End User, never an Org Admin**', async () => {
      // The escalation the whole split exists to prevent.
      const tenant = await seedTenantWithUser(fx.prisma, {
        organization: { allowedEmailDomains: ['acme.test'] },
      });

      const resolved = await users.resolveInboundSender({
        organizationId: tenant.org.id,
        email: 'newcomer@acme.test',
        displayName: 'A Newcomer',
      });

      expect(resolved.created).toBe(true);

      const created = await fx.prisma.user.findUniqueOrThrow({
        where: { id: resolved.userId },
        include: { roles: { select: { name: true } } },
      });

      expect(created.organizationId).toBe(tenant.org.id);
      expect(created.roles.map((role) => role.name)).toEqual([
        SystemRoleName.END_USER,
      ]);
      expect(created.fullName).toBe('A Newcomer');
      // No credential, and unverified: sending from an address proves neither
      // that you control it nor that you may sign in.
      expect(created.passwordHash).toBeNull();
      expect(created.isEmailVerified).toBe(false);
    });

    it('3. **a domain matching a DIFFERENT tenant is refused**', async () => {
      // A2's cross-tenant misroute, and the bug passes
      // every other test in this file. Self-signup's lookup is global: it asks
      // "which tenant claims this domain?", so a sender whose domain belongs to
      // someone else would be provisioned into THAT tenant while their mail was
      // addressed to this one.
      const addressed = await seedTenantWithUser(fx.prisma, {
        organization: { allowedEmailDomains: ['addressed.test'] },
      });
      const other = await seedTenantWithUser(fx.prisma, {
        organization: { allowedEmailDomains: ['elsewhere.test'] },
      });

      const resolved = await users.resolveInboundSender({
        organizationId: addressed.org.id,
        email: 'stranger@elsewhere.test',
      });

      expect(resolved.userId).toBeUndefined();
      expect(resolved.created).toBe(false);

      // And nothing was created in EITHER tenant — the misroute would have
      // written a row in `other`, which a check on `addressed` alone misses.
      expect(
        await fx.prisma.user.count({
          where: { email: 'stranger@elsewhere.test' },
        }),
      ).toBe(0);
      expect(other.org.id).not.toBe(addressed.org.id);
    });

    it('4. **a disallowed domain creates no user at all**', async () => {
      const tenant = await seedTenantWithUser(fx.prisma, {
        organization: { allowedEmailDomains: ['acme.test'] },
      });

      const resolved = await users.resolveInboundSender({
        organizationId: tenant.org.id,
        email: 'stranger@gmail.test',
      });

      expect(resolved.userId).toBeUndefined();
      expect(
        await fx.prisma.user.count({ where: { email: 'stranger@gmail.test' } }),
      ).toBe(0);
    });

    it('5. **and it creates no ORGANIZATION either**', async () => {
      // The runtime half of the static guard. Self-signup's no-match branch
      // creates a tenant and an Org Admin; this path must not, and counting
      // organizations is the assertion that survives a refactor of how.
      const tenant = await seedTenantWithUser(fx.prisma, {
        organization: { allowedEmailDomains: ['acme.test'] },
      });

      const before = await fx.prisma.organization.count();

      await users.resolveInboundSender({
        organizationId: tenant.org.id,
        email: 'stranger@nowhere.test',
      });

      expect(await fx.prisma.organization.count()).toBe(before);
    });

    it('6. the address is matched case-insensitively', async () => {
      const tenant = await seedTenantWithUser(fx.prisma);

      await expect(
        users.resolveInboundSender({
          organizationId: tenant.org.id,
          email: tenant.user.email.toUpperCase(),
        }),
      ).resolves.toEqual({ userId: tenant.user.id, created: false });
    });

    it('7. falls back to the local part when the sender has no display name', async () => {
      const tenant = await seedTenantWithUser(fx.prisma, {
        organization: { allowedEmailDomains: ['acme.test'] },
      });

      const resolved = await users.resolveInboundSender({
        organizationId: tenant.org.id,
        email: 'nameless@acme.test',
      });

      const created = await fx.prisma.user.findUniqueOrThrow({
        where: { id: resolved.userId },
      });

      expect(created.fullName).toBe('nameless');
    });
  });
});
