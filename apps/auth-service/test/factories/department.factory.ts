import { faker } from '@faker-js/faker';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

let deptIdx = 0;

export function buildDepartment(
  organizationId: string,
  overrides: Partial<Prisma.DepartmentUncheckedCreateInput> = {},
): Prisma.DepartmentUncheckedCreateInput {
  deptIdx++;
  return {
    organizationId,
    name: `${faker.commerce.department()} ${deptIdx}`,
    description: faker.lorem.sentence(),
    ...overrides,
  };
}

export function createDepartment(
  prisma: PrismaService,
  organizationId: string,
  overrides: Partial<Prisma.DepartmentUncheckedCreateInput> = {},
) {
  return prisma.department.create({
    data: buildDepartment(organizationId, overrides),
  });
}

/**
 * Membership. `isPrimary` defaults to false because exactly one primary per
 * user is a DB-enforced invariant (`user_departments_primary_key`) — a factory
 * that defaulted it to true would make the second call to it fail, in a test
 * about something else.
 */
export function createUserDepartment(
  prisma: PrismaService,
  userId: string,
  departmentId: string,
  overrides: Partial<Prisma.UserDepartmentUncheckedCreateInput> = {},
) {
  return prisma.userDepartment.create({
    data: { userId, departmentId, isPrimary: false, ...overrides },
  });
}
