/**
 * @file `OtpApi` — the request/verify purpose split, and the guard that is
 * deliberately ABSENT.
 *
 * **No `EmailVerifiedGuard` here, on purpose.** These five routes are how an
 * unverified user BECOMES verified; gating them on verification would
 * deadlock the account. The row below proves the absence rather than merely
 * relying on the controller's docblock to say so — a guard added here by
 * habit (every other authenticated route in the codebase has one) would fail
 * it with a 403 that no other row would catch, since every other fixture in
 * this file signs `isEmailVerified: true`.
 *
 * **Throttling is out of scope.** `otpRequest`/`otpVerify` (plan 84 §3) wait
 * on plan 78 step 7; nothing here asserts a 429.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('otp', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  const accessToken = (isEmailVerified = true) =>
    sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const cookie = (isEmailVerified = true) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken(isEmailVerified)}`,
  });

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  beforeEach(() => {
    peers.reset();
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Otp')(
    '**an unverified caller is NOT blocked** — verifying email is how you stop being unverified',
    async () => {
      peers.auth.on('OtpService/RequestEmailVerification').reply({
        target: 'a***e@acme.com',
        expiresInMinutes: 10,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/email/verify/request`,
        undefined,
        cookie(false),
      );

      expect(response.status).toBe(202);
    },
  );

  rowFor('Otp')(
    'requesting email verification reaches the peer with the caller’s id, masked target back',
    async () => {
      peers.auth.on('OtpService/RequestEmailVerification').reply({
        target: 'a***e@acme.com',
        expiresInMinutes: 10,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/email/verify/request`,
        undefined,
        cookie(),
      );

      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({
        data: { target: 'a***e@acme.com', expiresInMinutes: 10 },
      });

      const [call] = peers.auth.calls('OtpService/RequestEmailVerification');
      expect(call.request).toMatchObject({ userId: USER });
    },
  );

  rowFor('Otp')(
    'requesting phone verification forwards the phone number, not the email endpoint',
    async () => {
      peers.auth.on('OtpService/RequestPhoneVerification').reply({
        target: '+44******1234',
        expiresInMinutes: 10,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/phone/verify/request`,
        { phoneNumber: '+441234561234' },
        cookie(),
      );

      expect(response.status).toBe(202);

      const [call] = peers.auth.calls('OtpService/RequestPhoneVerification');
      expect(call.request).toMatchObject({
        userId: USER,
        phoneNumber: '+441234561234',
      });
      expect(peers.auth.calls('OtpService/RequestEmailVerification')).toHaveLength(0);
    },
  );

  rowFor('Otp')('a verified email code round-trips the peer’s answer', async () => {
    peers.auth.on('OtpService/VerifyEmail').reply({
      verified: true,
      attemptsRemaining: 4,
      mustRequestNewCode: false,
    });

    const response = await new Session(gateway.baseUrl).post(
      `${API}/auth/email/verify`,
      { code: '123456' },
      cookie(),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { verified: true } });

    const [call] = peers.auth.calls('OtpService/VerifyEmail');
    expect(call.request).toMatchObject({ userId: USER, code: '123456' });
  });

  rowFor('Otp')(
    '**a burned code reports `mustRequestNewCode`** on the phone route — the sibling of the email one',
    async () => {
      peers.auth.on('OtpService/VerifyPhone').reply({
        verified: false,
        attemptsRemaining: 0,
        mustRequestNewCode: true,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/phone/verify`,
        { code: '654321' },
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { verified: false, mustRequestNewCode: true },
      });
      expect(peers.auth.calls('OtpService/VerifyEmail')).toHaveLength(0);
    },
  );

  rowFor('Otp')(
    '**the status purpose is NOT swapped** — `PHONE_VERIFICATION` must not read the email challenge',
    async () => {
      peers.auth.on('OtpService/GetOtpStatus').reply({
        pending: true,
        target: '+44******1234',
        attemptsRemaining: 3,
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/auth/otp/status?purpose=PHONE_VERIFICATION`,
        cookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { pending: true, target: '+44******1234' },
      });

      const [call] = peers.auth.calls('OtpService/GetOtpStatus');
      // The proto enum's wire number for `OTP_PURPOSE_PHONE_VERIFICATION` — a
      // swap with `OTP_PURPOSE_EMAIL_VERIFICATION` (1) would pass a fixture
      // asserting only the response shape, which is why this reads the
      // REQUEST the peer actually received.
      expect(call.request).toMatchObject({ purpose: 2 });
    },
  );
});
