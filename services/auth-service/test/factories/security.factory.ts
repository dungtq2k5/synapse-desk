import { faker } from '@faker-js/faker';
import { randomBytes } from 'node:crypto';
import { OtpPurpose } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import {
  addDays,
  addMinutes,
  generateBackupCode,
  hashCode,
  hashToken,
  normalizeBackupCode,
} from '../../src/common/utils';

// Backup codes, OTPs and password-reset tokens share one file because they
// share one property: each stores a HASH and the test needs the plaintext, so
// each helper returns both.
//
// WHICH hash is not cosmetic, and it differs by column:
//
// - Codes a human types — backup codes and OTPs — hash with `hashCode` (salted
//   scrypt), because that is what the service now writes. Seeding them with
//   `hashToken` instead would still PASS every existing test: `verifyCode`
//   reads legacy SHA-256 rows too. The suite would go green having exercised
//   only the legacy branch, and the scrypt path would have no e2e coverage at
//   all. That is why the default here is the load-bearing part of this file.
// - `passwordResetToken.tokenHash` stays `hashToken`. It is looked up BY VALUE
//   in a `@unique` column, which a randomly-salted hash makes impossible.
//
// `createLegacyBackupCode` is the one deliberate exception, and exists so a
// single test can prove pre-switch codes still verify.

export async function createBackupCode(
  prisma: PrismaService,
  userId: string,
  overrides: Partial<Prisma.TwoFactorBackupCodeUncheckedCreateInput> = {},
) {
  // The real generator, so the fixture's format matches what a user is shown.
  const code = generateBackupCode();

  const row = await prisma.twoFactorBackupCode.create({
    data: {
      userId,
      codeHash: await hashCode(normalizeBackupCode(code)),
      expiresAt: addDays(new Date(), 30),
      ...overrides,
    },
  });

  return { row, code };
}

/**
 * A backup code stored the way this service stored them BEFORE scrypt.
 *
 * Real rows in this format survive for `BACKUP_CODE_TTL_DAYS` — 365 in
 * `.env.example` — on paper in users' hands, and cannot be rewritten because a
 * hash does not invert. One test seeds through here to prove they still
 * verify; everything else must use `createBackupCode`, or the suite measures
 * the branch that is on its way out.
 */
export async function createLegacyBackupCode(
  prisma: PrismaService,
  userId: string,
  overrides: Partial<Prisma.TwoFactorBackupCodeUncheckedCreateInput> = {},
) {
  const code = generateBackupCode();

  const row = await prisma.twoFactorBackupCode.create({
    data: {
      userId,
      codeHash: hashToken(normalizeBackupCode(code)),
      expiresAt: addDays(new Date(), 30),
      ...overrides,
    },
  });

  return { row, code };
}

export async function createOtp(
  prisma: PrismaService,
  userId: string,
  overrides: Partial<Prisma.OtpUncheckedCreateInput> = {},
) {
  const code = faker.string.numeric(6);

  const row = await prisma.otp.create({
    data: {
      userId,
      purpose: OtpPurpose.EMAIL_VERIFICATION,
      target: faker.internet.email().toLowerCase(),
      codeHash: await hashCode(code),
      expiresAt: addMinutes(new Date(), 10),
      ...overrides,
    },
  });

  return { row, code };
}

export async function createPasswordResetToken(
  prisma: PrismaService,
  userId: string,
  overrides: Partial<Prisma.PasswordResetTokenUncheckedCreateInput> = {},
) {
  const token = randomBytes(32).toString('base64url');

  const row = await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ipAddress: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      expiresAt: addMinutes(new Date(), 60),
      ...overrides,
    },
  });

  return { row, token };
}
