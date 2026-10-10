import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
  superAdminContext,
  superuser,
} from '../utils';
import { addMember, createDepartment, seedTenantWithUser } from '../factories';
import { DepartmentsService } from '../../src/modules/departments/departments.service';
import { UsersService } from '../../src/modules/users/users.service';
import { PlatformService } from '../../src/modules/platform/platform.service';

/**
 * the soft-delete sweep.
 *
 * Soft deletion only works if EVERY list honours it. One endpoint that forgets
 * the `deletedAt: null` filter puts a deactivated employee back on a directory
 * page, and the failure is invisible until someone notices a name that should
 * not be there — by which point nobody remembers which endpoint is new.
 *
 * The `includeDeleted` escape hatch gets its own half of the sweep, because it
 * is the other way to get this wrong: an override that works without the
 * permission behind it is not an override, it is the filter not being applied.
 */
describe('soft-delete sweep (e2e)', () => {
  let fx: E2eFixture;
  let departments: DepartmentsService;
  let users: UsersService;
  let platform: PlatformService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    departments = fx.moduleRef.get(DepartmentsService);
    users = fx.moduleRef.get(UsersService);
    platform = fx.moduleRef.get(PlatformService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  describe('departments', () => {
    it('a soft-deleted department is ABSENT from the default list', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await createDepartment(fx.prisma, t.org.id);
      const kept = await createDepartment(fx.prisma, t.org.id);

      await departments.deleteDepartment({ id: gone.id }, superuser(t));

      const list = await departments.listDepartments(
        { page: pageRequest(), includeDeleted: false },
        superuser(t),
      );

      const ids = list.items.map((d) => d.id);
      expect(ids).not.toContain(gone.id);
      expect(ids).toContain(kept.id);
    });

    it('includeDeleted brings it back, WITH its deletion metadata', async () => {
      // The recycle-bin view. Returning the row without saying who deleted it
      // and when makes the view unusable for the decision it exists to support.
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await createDepartment(fx.prisma, t.org.id);

      await departments.deleteDepartment({ id: gone.id }, superuser(t));

      const list = await departments.listDepartments(
        { page: pageRequest(), includeDeleted: true },
        superuser(t),
      );

      const row = list.items.find((d) => d.id === gone.id);
      expect(row).toBeDefined();
      expect(row!.deletedAt).toBeTruthy();
    });

    it('the COUNT in the page meta follows the same filter as the items', async () => {
      // A meta that counts deleted rows while the items exclude them produces a
      // paginator claiming a page 2 that is empty — and it is the kind of thing
      // an items-only assertion never catches.
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await createDepartment(fx.prisma, t.org.id);
      await createDepartment(fx.prisma, t.org.id);

      await departments.deleteDepartment({ id: gone.id }, superuser(t));

      const hidden = await departments.listDepartments(
        { page: pageRequest(), includeDeleted: false },
        superuser(t),
      );
      const shown = await departments.listDepartments(
        { page: pageRequest(), includeDeleted: true },
        superuser(t),
      );

      expect(hidden.meta!.totalItems).toBe(hidden.items.length);
      expect(shown.meta!.totalItems).toBe(shown.items.length);
      expect(shown.meta!.totalItems).toBe(hidden.meta!.totalItems + 1);
    });

    it('a soft-deleted department is invisible to getDepartment too', async () => {
      // The list filter alone is not the guarantee: an id that still resolves
      // by direct read is a deleted row that never really went away.
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await createDepartment(fx.prisma, t.org.id);

      await departments.deleteDepartment({ id: gone.id }, superuser(t));

      await expect(
        departments.getDepartment({ id: gone.id }, superuser(t)),
      ).rejects.toBeDefined();
    });
  });

  describe('users', () => {
    it('a soft-deleted user is ABSENT from the default list', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await addMember(fx.prisma, t.org.id);
      const kept = await addMember(fx.prisma, t.org.id);

      await users.deleteUser({ id: gone.id }, superuser(t));

      const list = await users.listUsers(
        {
          page: pageRequest(),
          includeDeleted: false,
          departmentId: '',
          roleId: '',
        },
        superuser(t),
      );

      const ids = list.items.map((i) => i.user!.id);
      expect(ids).not.toContain(gone.id);
      expect(ids).toContain(kept.id);
    });

    it('includeDeleted brings them back with deletedAt set', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await addMember(fx.prisma, t.org.id);

      await users.deleteUser({ id: gone.id }, superuser(t));

      const list = await users.listUsers(
        {
          page: pageRequest(),
          includeDeleted: true,
          departmentId: '',
          roleId: '',
        },
        superuser(t),
      );

      const row = list.items.find((i) => i.user!.id === gone.id);
      expect(row).toBeDefined();
      expect(row!.deletedAt).toBeTruthy();
    });

    it('a soft-deleted user is invisible to getUser too', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await addMember(fx.prisma, t.org.id);

      await users.deleteUser({ id: gone.id }, superuser(t));

      await expect(
        users.getUser({ id: gone.id }, superuser(t)),
      ).rejects.toBeDefined();
    });

    it('a soft-deleted user cannot LOG IN — the filter reaches the auth path', async () => {
      // The one that matters most: a directory that hides them while the login
      // query does not is an offboarding that offboarded nothing.
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await addMember(fx.prisma, t.org.id);

      await users.deleteUser({ id: gone.id }, superuser(t));

      const candidates = await fx.prisma.user.findMany({
        where: { email: gone.email, deletedAt: null },
      });
      expect(candidates).toHaveLength(0);
    });

    it('a soft-deleted user frees their seat', async () => {
      // The counter reads the same filter, so an offboarded employee must stop
      // costing a seat the moment they are deactivated.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 50 },
      });
      const gone = await addMember(fx.prisma, t.org.id);

      const before = await fx.prisma.user.count({
        where: { organizationId: t.org.id, deletedAt: null },
      });
      await users.deleteUser({ id: gone.id }, superuser(t));

      expect(
        await fx.prisma.user.count({
          where: { organizationId: t.org.id, deletedAt: null },
        }),
      ).toBe(before - 1);
    });
  });

  describe('organizations (platform)', () => {
    it('an offboarded tenant is ABSENT from the default platform list', async () => {
      const superAdmin = await fx.prisma.user.findFirstOrThrow({
        where: { isSuperAdmin: true },
      });
      const ctx = superAdminContext(superAdmin.id);

      const gone = await seedTenantWithUser(fx.prisma);
      const kept = await seedTenantWithUser(fx.prisma);

      await platform.offboardOrganization(
        { organizationId: gone.org.id, reason: 'churned' },
        ctx,
      );

      const list = await platform.listOrganizations({
        page: pageRequest(),
        includeDeleted: false,
        status: undefined,
      });

      const ids = list.items.map((i) => i.organization!.id);
      expect(ids).not.toContain(gone.org.id);
      expect(ids).toContain(kept.org.id);
    });

    it('includeDeleted brings it back', async () => {
      const superAdmin = await fx.prisma.user.findFirstOrThrow({
        where: { isSuperAdmin: true },
      });
      const gone = await seedTenantWithUser(fx.prisma);

      await platform.offboardOrganization(
        { organizationId: gone.org.id, reason: 'churned' },
        superAdminContext(superAdmin.id),
      );

      const list = await platform.listOrganizations({
        page: pageRequest(),
        includeDeleted: true,
        status: undefined,
      });

      expect(list.items.map((i) => i.organization!.id)).toContain(gone.org.id);
    });
  });

  describe('the escape hatch is gated at the GATEWAY, not here', () => {
    it('the service honours includeDeleted for anyone who reaches it', async () => {
      // Worth stating rather than leaving implicit. `includeDeleted` is a plain
      // request flag: the service applies it as asked, and the PERMISSION check
      // that decides who may ask lives on the route (`@RequirePermission`), not
      // in the query.
      //
      // That split is deliberate — the service has no route metadata to read —
      // but it means a new gateway route exposing this flag without the
      // matching permission is a hole the service cannot close. The gateway
      // sweep is where that is enforced.
      const t = await seedTenantWithUser(fx.prisma);
      const gone = await createDepartment(fx.prisma, t.org.id);
      await departments.deleteDepartment({ id: gone.id }, superuser(t));

      const narrowActor = memberContext(t.user, ['department.read']);
      const list = await departments.listDepartments(
        { page: pageRequest(), includeDeleted: true },
        narrowActor,
      );

      expect(list.items.map((d) => d.id)).toContain(gone.id);
    });
  });
});
