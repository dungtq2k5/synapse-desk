import { bootstrapE2eTest, E2eFixture } from './utils/bootstrap';
import { OrgStatus, PERMISSION_CODES } from '@synapsedesk/common';

/**
 * Proves the fixture itself, before any suite depends on it.
 *
 * Worth its own file because every failure below is one that would otherwise
 * surface as a confusing failure in an unrelated module suite: "role not found"
 * when the seed never ran, or a duplicate-email test passing because the
 * partial index it targets was never created.
 */
describe('e2e bootstrap (auth-service)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  it('points at the TEST database, never the dev one', () => {
    expect(process.env.DATABASE_URL).toContain('synapsedesk_auth_test');
    expect(process.env.DATABASE_URL).not.toMatch(/synapsedesk_auth\?/);
  });

  it('seeds the full permission catalogue', async () => {
    const count = await fx.prisma.permission.count();
    expect(count).toBe(PERMISSION_CODES.length);
  });

  it('seeds the four global system roles', async () => {
    const roles = await fx.prisma.role.findMany({
      where: { organizationId: null, isSystemRole: true },
      select: { name: true },
    });
    expect(roles).toHaveLength(4);
  });

  it('applies the partial unique indexes that live outside schema.prisma', async () => {
    const indexes = await fx.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `;
    const names = indexes.map((i) => i.indexname);

    // If these are missing, every "duplicate is rejected" test in the suite
    // still passes — on the service-layer pre-check alone — and the database
    // constraint they are actually about is never exercised.
    expect(names).toEqual(
      expect.arrayContaining([
        'users_org_email_key',
        'users_super_admin_email_key',
        'user_invitations_pending_key',
        'departments_org_name_key',
        'user_departments_primary_key',
        'roles_global_name_key',
      ]),
    );
  });

  it('reset() clears tenant data but leaves the seeded catalogue', async () => {
    await fx.prisma.organization.create({
      data: {
        name: 'Throwaway',
        slug: `throwaway-${Date.now()}`,
        status: OrgStatus.ACTIVE,
      },
    });
    expect(await fx.prisma.organization.count()).toBe(1);

    await fx.reset();

    expect(await fx.prisma.organization.count()).toBe(0);
    expect(await fx.prisma.permission.count()).toBe(PERMISSION_CODES.length);
    expect(
      await fx.prisma.role.count({ where: { organizationId: null } }),
    ).toBe(4);
  });
});
