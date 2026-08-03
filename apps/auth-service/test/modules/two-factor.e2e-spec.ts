import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { generateSync } from 'otplib';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { requestOrigin } from '../utils/context';
import {
  createBackupCode,
  createTrustedDeviceSession,
  seedTenantWithUser,
  TEST_PASSWORD,
} from '../factories';
import { TwoFactorAuthService } from '../../src/modules/auth/two-factor-auth.service';
import { AuthService } from '../../src/modules/auth/auth.service';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('§2.2 Two-factor auth (e2e)', () => {
  let fx: E2eFixture;
  let twoFactor: TwoFactorAuthService;
  let auth: AuthService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    twoFactor = fx.moduleRef.get(TwoFactorAuthService);
    auth = fx.moduleRef.get(AuthService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  /**
   * Reads the shared secret out of the otpauth:// URI.
   *
   * The setup RPC deliberately does NOT return the raw secret — only the URI
   * and its QR rendering, which is what a real authenticator app consumes. So
   * the test extracts it the same way the app does, rather than reaching into
   * the database and decrypting `two_factor_secret`, which would test the
   * fixture's knowledge of the storage format instead of the enrolment flow.
   */
  function secretFromUri(otpauthUri: string): string {
    const secret = new URL(otpauthUri).searchParams.get('secret');
    if (!secret) throw new Error(`No secret in otpauth URI: ${otpauthUri}`);
    return secret;
  }

  /** Enrols a user end to end and returns their TOTP secret + backup codes. */
  async function enrol(userId: string) {
    const setup = await twoFactor.generateTwoFactor({ userId });
    const secret = secretFromUri(setup.otpauthUri);
    const activated = await twoFactor.activateTwoFactor({
      userId,
      code: generateSync({ secret }),
    });
    return { secret, backupCodes: activated.backupCodes };
  }

  describe('generateTwoFactor (setup)', () => {
    it('1. setup on an already-enabled account is FAILED_PRECONDITION', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);

      await expectRpc(
        twoFactor.generateTwoFactor({ userId: user.id }),
        status.FAILED_PRECONDITION,
      );
      await expectRpc(
        twoFactor.activateTwoFactor({ userId: user.id, code: '000000' }),
        status.FAILED_PRECONDITION,
      );
    });

    it('setup stores the secret but leaves 2FA OFF until a code is verified', async () => {
      // Half-enrolment must not lock anyone out: a secret written with the flag
      // already flipped would demand codes from an authenticator app the user
      // never finished adding.
      const { user } = await seedTenantWithUser(fx.prisma);

      await twoFactor.generateTwoFactor({ userId: user.id });

      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.twoFactorSecret).not.toBeNull();
      expect(row.isTwoFactorEnabled).toBe(false);
    });
  });

  describe('activateTwoFactor (enable)', () => {
    it('5. enable with a wrong code is rejected and 2FA stays off', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await twoFactor.generateTwoFactor({ userId: user.id });

      await expect(
        twoFactor.activateTwoFactor({ userId: user.id, code: '000000' }),
      ).rejects.toBeInstanceOf(RpcException);

      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.isTwoFactorEnabled).toBe(false);
      expect(
        await fx.prisma.twoFactorBackupCode.count({
          where: { userId: user.id },
        }),
      ).toBe(0);
    });

    it('6. enable returns plaintext backup codes exactly once', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { backupCodes } = await enrol(user.id);

      expect(backupCodes.length).toBeGreaterThan(0);

      // The status endpoint counts them and nothing more — there is no second
      // read of the plaintext, because only the hash was kept.
      const stored = await fx.prisma.twoFactorBackupCode.findMany({
        where: { userId: user.id },
      });
      expect(stored).toHaveLength(backupCodes.length);
      for (const code of backupCodes) {
        expect(stored.some((row) => row.codeHash === code)).toBe(false);
      }

      const statusResponse = await twoFactor.getBackupCodesStatus({
        userId: user.id,
      });
      expect(statusResponse.remaining).toBe(backupCodes.length);
      expect(JSON.stringify(statusResponse)).not.toContain(backupCodes[0]);
    });
  });

  describe('authenticateTwoFactor — trusted devices', () => {
    it('7. authenticate with rememberDevice issues a device token and a trust horizon', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { secret } = await enrol(user.id);

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      expect(login.requiresTwoFactor).toBe(true);

      const result = await twoFactor.authenticateTwoFactor(
        {
          twoFactorToken: login.twoFactorToken!,
          code: generateSync({ secret }),
          rememberDevice: true,
        },
        requestOrigin(),
      );

      expect(result.deviceToken).toBeTruthy();

      const session = await fx.prisma.deviceSession.findFirstOrThrow({
        where: { userId: user.id, isTrusted: true },
      });
      expect(session.deviceTokenHash).not.toBeNull();
      expect(session.trustedUntil).not.toBeNull();

      // ~30 days out, per TRUSTED_DEVICE_TTL_DAYS. Asserted as a window rather
      // than an exact instant so the test does not fail on clock drift.
      const days =
        (session.trustedUntil!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThan(31);
    });

    it('8. the next login from that device skips the challenge', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { secret } = await enrol(user.id);

      const first = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      const authed = await twoFactor.authenticateTwoFactor(
        {
          twoFactorToken: first.twoFactorToken!,
          code: generateSync({ secret }),
          rememberDevice: true,
        },
        requestOrigin(),
      );

      const second = await auth.login(
        {
          email: user.email,
          password: TEST_PASSWORD,
          deviceToken: authed.deviceToken,
        },
        requestOrigin(),
      );

      expect(second.requiresTwoFactor).toBe(false);
      expect(second.accessToken).toBeTruthy();
    });

    it('8b. an EXPIRED trust horizon does not skip the challenge', async () => {
      // `trustedUntil` is what bounds the bypass. If the lookup ignored it, a
      // device trusted once would be trusted forever.
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);

      const { deviceToken } = await createTrustedDeviceSession(
        fx.prisma,
        user.id,
        {
          trustedUntil: new Date(Date.now() - 1000),
        },
      );

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD, deviceToken },
        requestOrigin(),
      );
      expect(login.requiresTwoFactor).toBe(true);
    });

    it("8c. one user's device token does not trust another user", async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const other = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);

      const { deviceToken } = await createTrustedDeviceSession(
        fx.prisma,
        other.user.id,
      );

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD, deviceToken },
        requestOrigin(),
      );
      expect(login.requiresTwoFactor).toBe(true);
    });
  });

  describe('authenticateTwoFactor — backup codes', () => {
    it('9. a backup code is single-use', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { backupCodes } = await enrol(user.id);
      const code = backupCodes[0];

      const first = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      await twoFactor.authenticateTwoFactor(
        {
          twoFactorToken: first.twoFactorToken!,
          backupCode: code,
          rememberDevice: false,
        },
        requestOrigin(),
      );

      const second = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      await expect(
        twoFactor.authenticateTwoFactor(
          {
            twoFactorToken: second.twoFactorToken!,
            backupCode: code,
            rememberDevice: false,
          },
          requestOrigin(),
        ),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('9b. a used code is marked used, not deleted', async () => {
      // So "already used" stays distinguishable from "never existed" in the
      // audit trail.
      const { user } = await seedTenantWithUser(fx.prisma);
      const { backupCodes } = await enrol(user.id);

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      await twoFactor.authenticateTwoFactor(
        {
          twoFactorToken: login.twoFactorToken!,
          backupCode: backupCodes[0],
          rememberDevice: false,
        },
        requestOrigin(),
      );

      expect(
        await fx.prisma.twoFactorBackupCode.count({
          where: { userId: user.id, isUsed: true },
        }),
      ).toBe(1);
      expect(
        await fx.prisma.twoFactorBackupCode.count({
          where: { userId: user.id },
        }),
      ).toBe(backupCodes.length);
    });

    it('9c. an expired backup code is refused', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);
      const { code } = await createBackupCode(fx.prisma, user.id, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      await expect(
        twoFactor.authenticateTwoFactor(
          {
            twoFactorToken: login.twoFactorToken!,
            backupCode: code,
            rememberDevice: false,
          },
          requestOrigin(),
        ),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('disableTwoFactor', () => {
    it('10. disable is blocked while the tenant enforces 2FA', async () => {
      const { user } = await seedTenantWithUser(fx.prisma, {
        organization: { enforceTwoFactor: true },
      });
      const { secret } = await enrol(user.id);

      await expectRpc(
        twoFactor.disableTwoFactor({
          userId: user.id,
          password: TEST_PASSWORD,
          code: generateSync({ secret }),
        }),
        status.FAILED_PRECONDITION,
      );

      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.isTwoFactorEnabled).toBe(true);
    });

    it('10b. disable clears the secret and every backup code', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { secret } = await enrol(user.id);

      await twoFactor.disableTwoFactor({
        userId: user.id,
        password: TEST_PASSWORD,
        code: generateSync({ secret }),
      });

      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.isTwoFactorEnabled).toBe(false);
      expect(row.twoFactorSecret).toBeNull();
      expect(
        await fx.prisma.twoFactorBackupCode.count({
          where: { userId: user.id },
        }),
      ).toBe(0);
    });
  });

  describe('regenerateBackupCodes / getBackupCodesStatus', () => {
    it('11. regeneration invalidates every previously unused code', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { backupCodes } = await enrol(user.id);

      const regenerated = await twoFactor.regenerateBackupCodes({
        userId: user.id,
        password: TEST_PASSWORD,
      });

      // The old set is gone entirely, not merely superseded.
      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      await expect(
        twoFactor.authenticateTwoFactor(
          {
            twoFactorToken: login.twoFactorToken!,
            backupCode: backupCodes[0],
            rememberDevice: false,
          },
          requestOrigin(),
        ),
      ).rejects.toBeInstanceOf(RpcException);

      expect(
        await fx.prisma.twoFactorBackupCode.count({
          where: { userId: user.id },
        }),
      ).toBe(regenerated.backupCodes.length);
    });

    it('13. the status response carries neither a hash nor a plaintext code', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);

      const result = await twoFactor.getBackupCodesStatus({ userId: user.id });

      expect(Object.keys(result).sort()).toEqual(
        ['expiresAt', 'remaining', 'used'].sort(),
      );
    });

    it('an enrolled account still refuses a wrong TOTP code', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      await expect(
        twoFactor.authenticateTwoFactor(
          {
            twoFactorToken: login.twoFactorToken!,
            code: '000000',
            rememberDevice: false,
          },
          requestOrigin(),
        ),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('authenticateTwoFactor — rejection paths', () => {
    it('an access token cannot stand in for a 2FA challenge token', async () => {
      // Separate keypairs, and this is the test that proves the separation is
      // real rather than intended.
      const { user } = await seedTenantWithUser(fx.prisma);
      const { secret } = await enrol(user.id);

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      const authed = await twoFactor.authenticateTwoFactor(
        {
          twoFactorToken: login.twoFactorToken!,
          code: generateSync({ secret }),
          rememberDevice: false,
        },
        requestOrigin(),
      );

      await expectRpc(
        twoFactor.authenticateTwoFactor(
          {
            twoFactorToken: authed.accessToken,
            code: generateSync({ secret }),
            rememberDevice: false,
          },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
    });
  });
});
