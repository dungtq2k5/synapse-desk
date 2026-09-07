import { RpcException } from '@nestjs/microservices';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { generateSync } from 'otplib';
import { compareAlphabetically } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, requestOrigin } from '../utils';
import {
  createBackupCode,
  createLegacyBackupCode,
  createTrustedDeviceSession,
  seedTenantWithUser,
  TEST_PASSWORD,
} from '../factories';
import { TwoFactorAuthService } from '../../src/modules/auth/two-factor-auth.service';
import { AuthService } from '../../src/modules/auth/auth.service';

describe('Two-factor auth (e2e)', () => {
  let fx: E2eFixture;
  let twoFactor: TwoFactorAuthService;
  let auth: AuthService;

  /**
   * Reads the shared secret out of the otpauth:// URI.
   *
   * The setup RPC deliberately does NOT return the raw secret — only the URI
   * and its QR rendering, which is what a real authenticator app consumes. So
   * the test extracts it the same way the app does, rather than reaching into
   * the database and decrypting `two_factor_secret`, which would test the
   * fixture's knowledge of the storage format instead of the enrolment flow.
   */
  const secretFromUri = (otpauthUri: string): string => {
    const secret = new URL(otpauthUri).searchParams.get('secret');
    if (!secret) throw new Error(`No secret in otpauth URI: ${otpauthUri}`);
    return secret;
  };

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

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    twoFactor = fx.moduleRef.get(TwoFactorAuthService);
    auth = fx.moduleRef.get(AuthService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

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

    it('6b. stored codes are SALTED SCRYPT — service and factory alike', async () => {
      // Fifty bits from a CSPRNG holds off an online guesser and does not hold
      // off an offline one with `BACKUP_CODE_TTL_DAYS` — 365 in `.env.example`
      // — to work: at SHA-256 speed a leaked table gives up a code in about a
      // day on one GPU.
      //
      // The seeded half is the one that can rot silently. `verifyCode` still
      // reads legacy SHA-256, so a `createBackupCode` quietly reverted to
      // `hashToken` leaves every other test in this file green — measured: all
      // nineteen of them — while the scrypt path goes uncovered.
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);

      const issued = await fx.prisma.twoFactorBackupCode.findMany({
        where: { userId: user.id },
      });
      expect(issued.length).toBeGreaterThan(0);
      expect(issued.every((row) => row.codeHash.startsWith('scrypt$'))).toBe(
        true,
      );

      const { row: seeded } = await createBackupCode(fx.prisma, user.id);
      expect(seeded.codeHash.startsWith('scrypt$')).toBe(true);
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

    it('9d. a LEGACY SHA-256 code still verifies — they are on paper for a year', async () => {
      // `BACKUP_CODE_TTL_DAYS` is 365 in `.env.example`, so codes printed
      // before the switch to scrypt outlive it by a long way. Nothing can
      // rewrite them: a hash does not invert, and a code is single-use, so
      // "upgrade on successful verify" would upgrade a row about to be burned.
      // This is the one deliberate use of the legacy seeder in the suite.
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);
      const { code } = await createLegacyBackupCode(fx.prisma, user.id);

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      const result = await twoFactor.authenticateTwoFactor(
        {
          twoFactorToken: login.twoFactorToken!,
          backupCode: code,
          rememberDevice: false,
        },
        requestOrigin(),
      );

      expect(result.accessToken).toBeTruthy();
    });

    it('9e. an UNRECOGNIZED stored hash is an invalid code, not a server error', async () => {
      // `verifyCode` must never throw on a stored value it cannot parse. Rows
      // like this exist — `users.e2e-spec.ts` seeds `codeHash: 'stub-hash'` —
      // and a throw here would surface to the caller as INTERNAL on what was
      // only a bad code, which is both a worse error and an oracle.
      const { user } = await seedTenantWithUser(fx.prisma);
      await enrol(user.id);
      const { code } = await createBackupCode(fx.prisma, user.id, {
        codeHash: 'stub-hash',
      });

      const login = await auth.login(
        { email: user.email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      await expectRpc(
        twoFactor.authenticateTwoFactor(
          {
            twoFactorToken: login.twoFactorToken!,
            backupCode: code,
            rememberDevice: false,
          },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
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

      expect(Object.keys(result).sort(compareAlphabetically)).toEqual(
        ['expiresAt', 'remaining', 'used'].sort(compareAlphabetically),
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
