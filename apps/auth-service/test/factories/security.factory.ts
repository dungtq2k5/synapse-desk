import { faker } from '@faker-js/faker';
import { randomBytes } from 'node:crypto';
import { OtpPurpose } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import {
  addDays,
  addMinutes,
  generateBackupCode,
  hashToken,
  normalizeBackupCode,
} from '../../src/common/utils';

/**
 * Backup codes, OTPs and password-reset tokens share one file because they
 * share one property: each stores a HASH and the test needs the plaintext, so
 * each helper returns both.
 *
 * All three hash with `hashToken` (SHA-256) — deliberately NOT bcrypt, and the
 * distinction is not cosmetic. Every one of these is looked up BY VALUE, which
 * a randomly-salted hash makes impossible; the code path would have to bcrypt
 * every row on every attempt. A factory that reached for bcrypt because
 * "passwords use bcrypt" would produce fixtures the service can never verify,
 * and the resulting failure points nowhere near the mistake.
 */

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
      codeHash: hashToken(code),
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
