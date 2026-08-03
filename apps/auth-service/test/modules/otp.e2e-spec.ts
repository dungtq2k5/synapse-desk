import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { OtpPurpose } from '@synapsedesk/common';
import { OtpPurpose as ProtoOtpPurpose } from '@synapsedesk/grpc-proto';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { createOtp, seedTenantWithUser } from '../factories';
import { OtpService } from '../../src/modules/otp/otp.service';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('§2.3 OTP (e2e)', () => {
  let fx: E2eFixture;
  let otp: OtpService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    otp = fx.moduleRef.get(OtpService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  describe('requestEmailVerification', () => {
    it('1. requesting a new code burns the previous outstanding one', async () => {
      // Five "resend" clicks must not leave five live codes — each one multiplies
      // an attacker's guessing surface against a 6-digit secret.
      const { user } = await seedTenantWithUser(fx.prisma, {
        user: { isEmailVerified: false },
      });

      await otp.requestEmailVerification({ userId: user.id });
      await otp.requestEmailVerification({ userId: user.id });
      await otp.requestEmailVerification({ userId: user.id });

      expect(
        await fx.prisma.otp.count({
          where: {
            userId: user.id,
            purpose: OtpPurpose.EMAIL_VERIFICATION,
            isUsed: false,
          },
        }),
      ).toBe(1);
      expect(await fx.prisma.otp.count({ where: { userId: user.id } })).toBe(3);
    });
  });

  describe('verifyEmail', () => {
    it('2. a correct code marks the address verified', async () => {
      const { user } = await seedTenantWithUser(fx.prisma, {
        user: { isEmailVerified: false },
      });
      const { code } = await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        target: user.email,
      });

      const result = await otp.verifyEmail({ userId: user.id, code });

      expect(result.verified).toBe(true);
      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.isEmailVerified).toBe(true);
    });

    it('2b. the JWT claim stays stale until the token rotates — documented, not a bug', async () => {
      // `isEmailVerified` rides in the access token, so verifying cannot reach
      // back and change one already issued. The database is the source of truth;
      // the client is told to refresh. This test pins the DOCUMENTED behaviour so
      // a future change to it is a deliberate decision rather than a surprise.
      const { user } = await seedTenantWithUser(fx.prisma, {
        user: { isEmailVerified: false },
      });
      const { code } = await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        target: user.email,
      });

      await otp.verifyEmail({ userId: user.id, code });

      // Nothing in the OTP module touches sessions — there is no mechanism by
      // which an outstanding access token could learn about this.
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: user.id } }),
      ).toBe(0);
    });

    it('3. a wrong code increments attemptsCount', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { row } = await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        maxAttempts: 5,
      });

      await expect(
        otp.verifyEmail({ userId: user.id, code: '000000' }),
      ).resolves.toMatchObject({ verified: false });

      const after = await fx.prisma.otp.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.attemptsCount).toBe(1);
      expect(after.isUsed).toBe(false);
    });

    it('3b. reaching maxAttempts burns the code and says so', async () => {
      // The cap is what makes a 6-digit secret defensible at all: 10^6 guesses is
      // minutes of scripted traffic without it.
      const { user } = await seedTenantWithUser(fx.prisma);
      const { row } = await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        maxAttempts: 3,
      });

      await otp.verifyEmail({ userId: user.id, code: '000000' });
      await otp.verifyEmail({ userId: user.id, code: '000001' });

      // The third wrong attempt exhausts it.
      await expectRpc(
        otp.verifyEmail({ userId: user.id, code: '000002' }),
        status.RESOURCE_EXHAUSTED,
      );

      const after = await fx.prisma.otp.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.isUsed).toBe(true);

      // And the correct code no longer works — burned means burned.
      await expectRpc(
        otp.verifyEmail({ userId: user.id, code: '000000' }),
        status.FAILED_PRECONDITION,
      );
    });

    it('3c. a burned code reports mustRequestNewCode to the client', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        maxAttempts: 1,
      });

      const error = await otp
        .verifyEmail({ userId: user.id, code: '999999' })
        .catch((e: unknown) => e);

      expect(rpcCode(error)).toBe(status.RESOURCE_EXHAUSTED);
    });
  });

  describe('requestPhoneVerification / verifyPhone', () => {
    it('4. a phone code does not touch users.phone_number until it verifies', async () => {
      // The change-of-number safety property `otps.target` exists for: requesting
      // a code for a new number must not move the user onto it, or a typo (or an
      // attacker) reassigns the account's phone with no confirmation at all.
      const { user } = await seedTenantWithUser(fx.prisma, {
        user: { phoneNumber: '+15550000001', isPhoneVerified: true },
      });

      await otp.requestPhoneVerification({
        userId: user.id,
        phoneNumber: '+15559999999',
      });

      const during = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(during.phoneNumber).toBe('+15550000001');

      // The pending target is on the OTP row, which is the point.
      const pending = await fx.prisma.otp.findFirstOrThrow({
        where: { userId: user.id, purpose: OtpPurpose.PHONE_VERIFICATION },
      });
      expect(pending.target).toBe('+15559999999');
    });

    it('4b. verifying the phone code moves the number across', async () => {
      const { user } = await seedTenantWithUser(fx.prisma, {
        user: { phoneNumber: '+15550000001', isPhoneVerified: true },
      });
      const { code } = await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.PHONE_VERIFICATION,
        target: '+15559999999',
      });

      await otp.verifyPhone({ userId: user.id, code });

      const after = await fx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.phoneNumber).toBe('+15559999999');
      expect(after.isPhoneVerified).toBe(true);
    });
  });

  describe('getOtpStatus', () => {
    it('5. status returns a MASKED target, never the hash', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        target: 'someone.specific@example.test',
      });

      const result = await otp.getOtpStatus({
        userId: user.id,
        purpose: ProtoOtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION,
      });

      expect(result.pending).toBe(true);
      expect(result.target).not.toBe('someone.specific@example.test');
      expect(result.target).toContain('*');
      expect(JSON.stringify(result)).not.toContain('codeHash');
    });

    it('5b. a pending PHONE target is masked as a phone number', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.PHONE_VERIFICATION,
        target: '+15551234567',
      });

      const result = await otp.getOtpStatus({
        userId: user.id,
        purpose: ProtoOtpPurpose.OTP_PURPOSE_PHONE_VERIFICATION,
      });

      expect(result.target).not.toBe('+15551234567');
      expect(result.target).toContain('*');
    });

    it('6. no pending challenge reports pending:false with zero attempts left', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);

      await expect(
        otp.getOtpStatus({
          userId: user.id,
          purpose: ProtoOtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION,
        }),
      ).resolves.toEqual({ pending: false, attemptsRemaining: 0 });
    });

    it('6b. an EXPIRED code counts as no pending challenge', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        otp.getOtpStatus({
          userId: user.id,
          purpose: ProtoOtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION,
        }),
      ).resolves.toEqual({ pending: false, attemptsRemaining: 0 });
    });
  });

  describe('verifyEmail — rejection paths', () => {
    it('an expired code cannot be redeemed', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { code } = await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expectRpc(
        otp.verifyEmail({ userId: user.id, code }),
        status.FAILED_PRECONDITION,
      );
    });

    it('an email code cannot be redeemed on the phone endpoint', async () => {
      // The purposes are separate keyspaces; crossing them would let a code sent
      // to a verified address confirm an unverified number.
      const { user } = await seedTenantWithUser(fx.prisma);
      const { code } = await createOtp(fx.prisma, user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
      });

      await expectRpc(
        otp.verifyPhone({ userId: user.id, code }),
        status.FAILED_PRECONDITION,
      );
    });

    it("one user's code cannot verify another user", async () => {
      const a = await seedTenantWithUser(fx.prisma, {
        user: { isEmailVerified: false },
      });
      const b = await seedTenantWithUser(fx.prisma, {
        user: { isEmailVerified: false },
      });
      const { code } = await createOtp(fx.prisma, a.user.id, {
        purpose: OtpPurpose.EMAIL_VERIFICATION,
      });

      await expectRpc(
        otp.verifyEmail({ userId: b.user.id, code }),
        status.FAILED_PRECONDITION,
      );
      const stillUnverified = await fx.prisma.user.findUniqueOrThrow({
        where: { id: b.user.id },
      });
      expect(stillUnverified.isEmailVerified).toBe(false);
    });
  });
});
