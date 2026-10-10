import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcrypt';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/** See organization.factory.ts for why this counter exists. */
let userIdx = 0;

/**
 * The password every factory-built account uses.
 *
 * A shared constant rather than a random one per user: login tests need to
 * present it, and a helper that returns a random password forces every caller
 * to thread it through. `.env.test` sets BCRYPT_ROUNDS=4, so hashing it is
 * cheap enough to do inline.
 */
export const TEST_PASSWORD = 'TestPassw0rd!';

export function buildUser(
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
): Prisma.UserUncheckedCreateInput {
  userIdx++;
  return {
    email: `user${userIdx}.${faker.string.alphanumeric(6).toLowerCase()}@example.test`,
    fullName: faker.person.fullName(),
    // Null by default: it is the Google-sign-in shape, and a test that needs a
    // password must say so — `PATCH /auth/password` refusing a passwordless
    // account is a documented behaviour, and a factory that always sets a hash
    // would make that test the only one exercising the null branch.
    passwordHash: null,
    isEmailVerified: true,
    ...overrides,
  };
}

/** bcrypt hash of TEST_PASSWORD, at whatever cost .env.test configures. */
export function hashTestPassword(
  password: string = TEST_PASSWORD,
): Promise<string> {
  return bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS ?? 4));
}

export async function createUser(
  prisma: PrismaService,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  return prisma.user.create({ data: buildUser(overrides) });
}

/** A user who can actually log in. */
export async function createUserWithPassword(
  prisma: PrismaService,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
  password: string = TEST_PASSWORD,
) {
  return prisma.user.create({
    data: buildUser({
      passwordHash: await hashTestPassword(password),
      ...overrides,
    }),
  });
}
