import { status as GrpcStatus } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { seedTenantWithUser } from '../factories';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';

/**
 * Issuing, rotating and revoking a tenant's inbound address
 *
 * **Rotation is one of the three properties an opaque token was chosen for**,
 * and until these existed it was the one nothing implemented: the column could
 * be written by hand-editing a row and by nothing else, so no tenant could be
 * given an address at all.
 */
describe('§31 §2 the inbound token lifecycle (e2e)', () => {
  let fx: E2eFixture;
  let organizations: OrganizationsService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    organizations = fx.moduleRef.get(OrganizationsService);
  }, 30_000);

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  const caller = (tenant: Awaited<ReturnType<typeof seedTenantWithUser>>) => ({
    sub: tenant.user.id,
    organizationId: tenant.org.id,
    isSuperAdmin: false,
    departmentIds: [],
    permissionCodes: [],
    isEmailVerified: true,
    ip: '127.0.0.1',
    userAgent: 'jest',
  });

  it('1. **issuing makes the tenant addressable**', async () => {
    const tenant = await seedTenantWithUser(fx.prisma);

    // Nothing routes before it is issued — the opt-in default.
    expect(
      (
        await organizations.resolveOrgByInboundToken({
          inboundToken: 'x'.repeat(32),
        })
      ).organizationId,
    ).toBeUndefined();

    const { inboundToken } = await organizations.issueInboundToken(
      caller(tenant),
    );

    expect(inboundToken).toMatch(/^[0-9a-f]{32}$/);
    expect(
      (await organizations.resolveOrgByInboundToken({ inboundToken }))
        .organizationId,
    ).toBe(tenant.org.id);
  });

  it('2. **rotating stops the OLD address routing and starts the new one**', async () => {
    const tenant = await seedTenantWithUser(fx.prisma);

    const first = (await organizations.issueInboundToken(caller(tenant)))
      .inboundToken;
    const second = (await organizations.issueInboundToken(caller(tenant)))
      .inboundToken;

    expect(second).not.toBe(first);
    expect(
      (await organizations.resolveOrgByInboundToken({ inboundToken: first }))
        .organizationId,
    ).toBeUndefined();
    expect(
      (await organizations.resolveOrgByInboundToken({ inboundToken: second }))
        .organizationId,
    ).toBe(tenant.org.id);
  });

  it('3. **revoking makes the tenant unaddressable again**', async () => {
    const tenant = await seedTenantWithUser(fx.prisma);

    const { inboundToken } = await organizations.issueInboundToken(
      caller(tenant),
    );

    await organizations.revokeInboundToken(caller(tenant));

    expect(
      (await organizations.resolveOrgByInboundToken({ inboundToken }))
        .organizationId,
    ).toBeUndefined();
    expect(
      (
        await fx.prisma.organization.findUniqueOrThrow({
          where: { id: tenant.org.id },
        })
      ).inboundToken,
    ).toBeNull();
  });

  it('4. revoking twice is not an error', async () => {
    // The caller's intent is satisfied either way, and a second DELETE from a
    // retried request must not be a failure.
    const tenant = await seedTenantWithUser(fx.prisma);

    await organizations.issueInboundToken(caller(tenant));
    await organizations.revokeInboundToken(caller(tenant));

    await expect(
      organizations.revokeInboundToken(caller(tenant)),
    ).resolves.toEqual({});
  });

  it('5. **each tenant gets a DIFFERENT token**', async () => {
    // The routing key. A collision is a cross-tenant misroute, and the column's
    // unique constraint would turn one into an error rather than a silent
    // merge — this asserts they do not collide in the first place.
    const one = await seedTenantWithUser(fx.prisma);
    const two = await seedTenantWithUser(fx.prisma);

    const first = (await organizations.issueInboundToken(caller(one)))
      .inboundToken;
    const second = (await organizations.issueInboundToken(caller(two)))
      .inboundToken;

    expect(first).not.toBe(second);
  });

  it('6. **a caller with no tenant cannot issue one**', async () => {
    // `load()` resolves the tenant from the caller, so there is no request
    // shape in which an admin re-keys someone else's workspace.
    //
    // FAILED_PRECONDITION rather than UNAUTHENTICATED: the caller IS
    // authenticated — a platform Super Admin belongs to no tenant — and
    // `requireTenant` distinguishes the two. Asserting UNAUTHENTICATED here
    // passed for the wrong reason on the first attempt.
    await expectRpc(
      organizations.issueInboundToken({
        sub: 'nobody',
        organizationId: null,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
        ip: '127.0.0.1',
        userAgent: 'jest',
      }),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });
});
