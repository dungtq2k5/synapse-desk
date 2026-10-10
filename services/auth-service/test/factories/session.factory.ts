import { faker } from '@faker-js/faker';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { addDays, hashToken } from '../../src/common/utils';

/**
 * Creates a device session and returns the RAW refresh token alongside the row.
 *
 * The raw value is the whole point: `device_sessions.refresh_token_hash` stores
 * only the SHA-256, and a refresh/replay test has to present the plaintext the
 * client would hold. A factory that returned just the row would leave every
 * such test re-deriving it.
 */
export async function createDeviceSession(
  prisma: PrismaService,
  userId: string,
  overrides: Partial<Prisma.DeviceSessionUncheckedCreateInput> = {},
) {
  const refreshToken = randomBytes(32).toString('base64url');

  const session = await prisma.deviceSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      ipAddress: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      deviceName: faker.commerce.productName(),
      expiresAt: addDays(new Date(), 7),
      ...overrides,
    },
  });

  return { session, refreshToken };
}

/**
 * A session whose device is trusted — the "remember this device" state that
 * lets a later login skip the 2FA challenge. Returns the raw device token for
 * the same reason as above.
 */
export async function createTrustedDeviceSession(
  prisma: PrismaService,
  userId: string,
  overrides: Partial<Prisma.DeviceSessionUncheckedCreateInput> = {},
) {
  const deviceToken = randomBytes(32).toString('base64url');

  const { session, refreshToken } = await createDeviceSession(prisma, userId, {
    isTrusted: true,
    deviceTokenHash: hashToken(deviceToken),
    trustedUntil: addDays(new Date(), 30),
    ...overrides,
  });

  return { session, refreshToken, deviceToken };
}
