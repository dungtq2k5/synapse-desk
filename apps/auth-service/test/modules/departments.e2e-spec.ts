import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { memberContext, pageRequest } from '../utils/context';
import {
  addMember,
  createDepartment,
  createUserDepartment,
  seedForeignTenant,
  seedTenantWithUser,
} from '../factories';
import { DepartmentsService } from '../../src/modules/departments/departments.service';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('§3.3 Departments (e2e)', () => {
  let fx: E2eFixture;
  let departments: DepartmentsService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    departments = fx.moduleRef.get(DepartmentsService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  /** The caller context for a tenant's own admin. */
  const ctx = (t: { user: { id: string; organizationId: string | null } }) =>
    memberContext(t.user, [
      'department.read',
      'department.create',
      'department.update',
      'department.delete',
      'department.member.assign',
    ]);

  describe('createDepartment', () => {
    it('1. the name is unique among ACTIVE rows only', async () => {
      // Direct test of `departments_org_name_key`, which is partial on
      // `WHERE deleted_at IS NULL`. A full unique index would keep a deleted
      // department's name reserved forever.
      const t = await seedTenantWithUser(fx.prisma);

      const first = await departments.createDepartment(
        { name: 'Support', description: '' },
        ctx(t),
      );

      await expectRpc(
        departments.createDepartment(
          { name: 'Support', description: '' },
          ctx(t),
        ),
        status.ALREADY_EXISTS,
      );

      await departments.deleteDepartment({ id: first.id }, ctx(t));

      // The name is free again.
      await expect(
        departments.createDepartment(
          { name: 'Support', description: '' },
          ctx(t),
        ),
      ).resolves.toMatchObject({ name: 'Support' });
    });
  });

  describe('restoreDepartment', () => {
    it('1b. restoring into a re-taken name is a 409, not a 500', async () => {
      // Clearing `deleted_at` re-enters the partial index. Without the explicit
      // catch this surfaces as a raw P2002 and the client sees INTERNAL.
      const t = await seedTenantWithUser(fx.prisma);

      const original = await departments.createDepartment(
        { name: 'Billing', description: '' },
        ctx(t),
      );
      await departments.deleteDepartment({ id: original.id }, ctx(t));
      await departments.createDepartment(
        { name: 'Billing', description: '' },
        ctx(t),
      );

      await expectRpc(
        departments.restoreDepartment({ id: original.id }, ctx(t)),
        status.ALREADY_EXISTS,
      );
    });

    it('2. the same name in two tenants both succeed', async () => {
      const a = await seedTenantWithUser(fx.prisma);
      const b = await seedForeignTenant(fx.prisma);

      await expect(
        departments.createDepartment(
          { name: 'Support', description: '' },
          ctx(a),
        ),
      ).resolves.toMatchObject({ name: 'Support' });
      await expect(
        departments.createDepartment(
          { name: 'Support', description: '' },
          ctx(b),
        ),
      ).resolves.toMatchObject({ name: 'Support' });
    });
  });

  describe('deleteDepartment', () => {
    it('3. deleting a department with members is a 409 naming the count', async () => {
      // ABORTED, which the gateway maps to 409 — not FAILED_PRECONDITION, which
      // maps to 400. This is a conflict with the CURRENT state and is retryable
      // once the members move.
      const t = await seedTenantWithUser(fx.prisma);
      const dept = await createDepartment(fx.prisma, t.org.id);
      const one = await addMember(fx.prisma, t.org.id);
      const two = await addMember(fx.prisma, t.org.id);
      await createUserDepartment(fx.prisma, one.id, dept.id);
      await createUserDepartment(fx.prisma, two.id, dept.id);

      const error = await departments
        .deleteDepartment({ id: dept.id }, ctx(t))
        .catch((e: unknown) => e);

      expect(rpcCode(error)).toBe(status.ABORTED);
      expect((error as RpcException).getError()).toMatchObject({
        message: expect.stringContaining('2 member'),
      });
    });

    it('3b. an empty department deletes cleanly and disappears from the list', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const dept = await createDepartment(fx.prisma, t.org.id);

      await departments.deleteDepartment({ id: dept.id }, ctx(t));

      const list = await departments.listDepartments(
        { page: pageRequest(), includeDeleted: false },
        ctx(t),
      );
      expect(list.items.map((d) => d.id)).not.toContain(dept.id);
    });
  });

  describe('addDepartmentMembers', () => {
    it('4. a user id from another tenant cannot be added as a member', async () => {
      // Nothing in `user_departments`' FKs prevents this — both ids are
      // individually valid — so it must be an explicit application check.
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      const dept = await createDepartment(fx.prisma, mine.org.id);

      await expectRpc(
        departments.addDepartmentMembers(
          {
            departmentId: dept.id,
            userIds: [theirs.user.id],
            isPrimary: false,
          },
          ctx(mine),
        ),
        // NOT_FOUND, not PERMISSION_DENIED: "that user exists but is not yours"
        // confirms the id and turns this into a cross-tenant existence oracle.
        status.NOT_FOUND,
      );

      expect(
        await fx.prisma.userDepartment.count({
          where: { departmentId: dept.id },
        }),
      ).toBe(0);
    });

    it('4b. one foreign id poisons the whole batch — nothing is added', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      const dept = await createDepartment(fx.prisma, mine.org.id);
      const ok = await addMember(fx.prisma, mine.org.id);

      await expectRpc(
        departments.addDepartmentMembers(
          {
            departmentId: dept.id,
            userIds: [ok.id, theirs.user.id],
            isPrimary: false,
          },
          ctx(mine),
        ),
        status.NOT_FOUND,
      );

      expect(
        await fx.prisma.userDepartment.count({
          where: { departmentId: dept.id },
        }),
      ).toBe(0);
    });

    it('5. re-adding an existing member is idempotent, not a composite-PK crash', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const dept = await createDepartment(fx.prisma, t.org.id);
      const member = await addMember(fx.prisma, t.org.id);

      const first = await departments.addDepartmentMembers(
        { departmentId: dept.id, userIds: [member.id], isPrimary: false },
        ctx(t),
      );
      const second = await departments.addDepartmentMembers(
        { departmentId: dept.id, userIds: [member.id], isPrimary: false },
        ctx(t),
      );

      expect(first).toEqual({ addedCount: 1, updatedCount: 0 });
      expect(second).toEqual({ addedCount: 0, updatedCount: 1 });
      expect(
        await fx.prisma.userDepartment.count({
          where: { departmentId: dept.id },
        }),
      ).toBe(1);
    });

    it('5b. duplicate ids within one request collapse to a single membership', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const dept = await createDepartment(fx.prisma, t.org.id);
      const member = await addMember(fx.prisma, t.org.id);

      const result = await departments.addDepartmentMembers(
        {
          departmentId: dept.id,
          userIds: [member.id, member.id, member.id],
          isPrimary: false,
        },
        ctx(t),
      );

      expect(result.addedCount).toBe(1);
    });
  });

  describe('removeDepartmentMember', () => {
    it("6. removing a user's PRIMARY department is a 409, with no silent reassignment", async () => {
      // Reassigning someone's primary silently changes their ticket routing and
      // their RAG document scope without anyone deciding to.
      const t = await seedTenantWithUser(fx.prisma);
      const primary = await createDepartment(fx.prisma, t.org.id);
      const secondary = await createDepartment(fx.prisma, t.org.id);
      const member = await addMember(fx.prisma, t.org.id);

      await createUserDepartment(fx.prisma, member.id, primary.id, {
        isPrimary: true,
      });
      await createUserDepartment(fx.prisma, member.id, secondary.id);

      await expectRpc(
        departments.removeDepartmentMember(
          { departmentId: primary.id, userId: member.id },
          ctx(t),
        ),
        status.ABORTED,
      );

      const still = await fx.prisma.userDepartment.findUniqueOrThrow({
        where: {
          userId_departmentId: { userId: member.id, departmentId: primary.id },
        },
      });
      expect(still.isPrimary).toBe(true);
    });

    it('6b. removing the ONLY membership is allowed, primary or not', async () => {
      // Blocking it would make an employee impossible to take off a team.
      const t = await seedTenantWithUser(fx.prisma);
      const dept = await createDepartment(fx.prisma, t.org.id);
      const member = await addMember(fx.prisma, t.org.id);
      await createUserDepartment(fx.prisma, member.id, dept.id, {
        isPrimary: true,
      });

      await expect(
        departments.removeDepartmentMember(
          { departmentId: dept.id, userId: member.id },
          ctx(t),
        ),
      ).resolves.toBeDefined();

      expect(
        await fx.prisma.userDepartment.count({ where: { userId: member.id } }),
      ).toBe(0);
    });
  });

  describe('setPrimary (via addDepartmentMembers)', () => {
    it('7. two CONCURRENT set-primary requests leave exactly one primary', async () => {
      // The partial unique index `user_departments_primary_key` is the only thing
      // that makes this true. The service-layer demote-then-promote cannot: two
      // transactions both read "no other primary" and both write one.
      const t = await seedTenantWithUser(fx.prisma);
      const a = await createDepartment(fx.prisma, t.org.id);
      const b = await createDepartment(fx.prisma, t.org.id);
      const member = await addMember(fx.prisma, t.org.id);

      await createUserDepartment(fx.prisma, member.id, a.id);
      await createUserDepartment(fx.prisma, member.id, b.id);

      await Promise.allSettled([
        departments.addDepartmentMembers(
          { departmentId: a.id, userIds: [member.id], isPrimary: true },
          ctx(t),
        ),
        departments.addDepartmentMembers(
          { departmentId: b.id, userIds: [member.id], isPrimary: true },
          ctx(t),
        ),
      ]);

      const primaries = await fx.prisma.userDepartment.count({
        where: { userId: member.id, isPrimary: true },
      });
      expect(primaries).toBe(1);
    });

    it('7b. setting a new primary demotes the old one in the same transaction', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const a = await createDepartment(fx.prisma, t.org.id);
      const b = await createDepartment(fx.prisma, t.org.id);
      const member = await addMember(fx.prisma, t.org.id);

      await createUserDepartment(fx.prisma, member.id, a.id, {
        isPrimary: true,
      });

      await departments.addDepartmentMembers(
        { departmentId: b.id, userIds: [member.id], isPrimary: true },
        ctx(t),
      );

      const rows = await fx.prisma.userDepartment.findMany({
        where: { userId: member.id },
      });
      expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
      expect(rows.find((r) => r.isPrimary)!.departmentId).toBe(b.id);
    });
  });

  describe('getDepartment / tenant isolation', () => {
    it("8. reading another tenant's department by id is 404", async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      const foreign = await createDepartment(fx.prisma, theirs.org.id);

      await expectRpc(
        departments.getDepartment({ id: foreign.id }, ctx(mine)),
        status.NOT_FOUND,
      );
    });

    it('8b. every write against a foreign department is 404 too', async () => {
      // A read-only tenant filter would leave update and delete wide open.
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      const foreign = await createDepartment(fx.prisma, theirs.org.id);

      await expectRpc(
        departments.updateDepartment(
          { id: foreign.id, name: 'Hijacked' },
          ctx(mine),
        ),
        status.NOT_FOUND,
      );
      await expectRpc(
        departments.deleteDepartment({ id: foreign.id }, ctx(mine)),
        status.NOT_FOUND,
      );
      await expectRpc(
        departments.addDepartmentMembers(
          {
            departmentId: foreign.id,
            userIds: [mine.user.id],
            isPrimary: false,
          },
          ctx(mine),
        ),
        status.NOT_FOUND,
      );

      const untouched = await fx.prisma.department.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      expect(untouched.name).toBe(foreign.name);
    });
  });

  describe('listDepartmentMembers', () => {
    it('the member list is scoped to the department and excludes other tenants', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      const dept = await createDepartment(fx.prisma, mine.org.id);
      const member = await addMember(fx.prisma, mine.org.id);
      await createUserDepartment(fx.prisma, member.id, dept.id);

      const list = await departments.listDepartmentMembers(
        { departmentId: dept.id, page: pageRequest() },
        ctx(mine),
      );

      expect(list.items).toHaveLength(1);
      expect(list.items[0].user!.id).toBe(member.id);
      expect(list.items.some((row) => row.user!.id === theirs.user.id)).toBe(
        false,
      );
    });

    it('an empty user list is rejected rather than silently succeeding', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const dept = await createDepartment(fx.prisma, t.org.id);

      await expectRpc(
        departments.addDepartmentMembers(
          { departmentId: dept.id, userIds: [], isPrimary: false },
          ctx(t),
        ),
        status.INVALID_ARGUMENT,
      );
    });
  });
});
