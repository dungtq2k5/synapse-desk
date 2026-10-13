/**
 * @file `TwoFactorAuthApi` — two handler-body auth doors: `generate`/
 * `activate` admit EITHER a full session or a verified 2FA-challenge
 * cookie; `authenticate` admits ONLY the challenge cookie, never an access
 * token — the sharpest row in this file proves that reverse-direction
 * cross-key rejection, a property with no harness row before now.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('two-factor-auth', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
  const USER = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';

  const accessCookie = (algorithm: 'RS256' | 'RS384' = 'RS256') => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm, expiresIn: '15m' },
    )}`,
  });

  const challengeCookie = (
    sub = USER,
    algorithm: 'RS256' | 'RS384' = 'RS256',
  ) => ({
    cookie: `${GATEWAY_ENV.JWT_2FA_NAME}=${sign(
      { sub, is2faPending: true },
      TEST_KEYS.twoFactor(),
      {
        algorithm,
        expiresIn: '5m',
      },
    )}`,
  });

  const wireUser = (id: string) => ({
    id,
    organizationId: ORGANIZATION,
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    isEmailVerified: true,
    isPhoneVerified: false,
    isLocked: false,
    isTwoFactorEnabled: true,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
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

  rowFor('Two Factor Auth')(
    '**`generate` accepts a full session**',
    async () => {
      peers.auth.on('TwoFactorAuthService/GenerateTwoFactor').reply({
        otpauthUri: 'otpauth://totp/Acme:ada@example.com?secret=ABC',
        qrCodeDataUrl: 'data:image/png;base64,abc',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/setup`,
        undefined,
        accessCookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { otpauthUri: expect.stringContaining('otpauth://') },
      });
      const [call] = peers.auth.calls('TwoFactorAuthService/GenerateTwoFactor');
      expect(call.request).toMatchObject({ userId: USER });
    },
  );

  rowFor('Two Factor Auth')(
    '**`generate` falls back to a verified 2FA-challenge cookie when there is no full session**',
    async () => {
      peers.auth.on('TwoFactorAuthService/GenerateTwoFactor').reply({
        otpauthUri: 'otpauth://totp/Acme:ada@example.com?secret=ABC',
        qrCodeDataUrl: 'data:image/png;base64,abc',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/setup`,
        undefined,
        challengeCookie(),
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls('TwoFactorAuthService/GenerateTwoFactor');
      expect(call.request).toMatchObject({ userId: USER });
    },
  );

  rowFor('Two Factor Auth')(
    '**`generate` refuses a caller with neither a session nor a challenge**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/setup`,
        undefined,
        {},
      );

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: expect.stringContaining(
          'requires a valid session or a live login challenge',
        ),
      });
      expect(
        peers.auth.calls('TwoFactorAuthService/GenerateTwoFactor'),
      ).toHaveLength(0);
    },
  );

  rowFor('Two Factor Auth')(
    '**`activate` confirms the code and returns backup codes**',
    async () => {
      peers.auth
        .on('TwoFactorAuthService/ActivateTwoFactor')
        .reply({ backupCodes: ['code-1', 'code-2'] });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/enable`,
        { code: '123456' },
        accessCookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { backupCodes: ['code-1', 'code-2'], user: null },
      });
      // From a session it signs nobody in: no cookie is set or cleared.
      expect(response.setCookie).toEqual([]);
      const [call] = peers.auth.calls('TwoFactorAuthService/ActivateTwoFactor');
      expect(call.request).toMatchObject({ userId: USER, code: '123456' });
      expect(call.request).not.toHaveProperty('twoFactorToken');
    },
  );

  rowFor('Two Factor Auth')(
    '**`activate` through the challenge signs in: session cookies set, `mfa_token` cleared**',
    async () => {
      peers.auth.on('TwoFactorAuthService/ActivateTwoFactor').reply({
        backupCodes: ['code-1'],
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
        user: wireUser(USER),
      });
      const challenge = challengeCookie();

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/enable`,
        { code: '123456', deviceName: 'Chrome on macOS' },
        challenge,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { backupCodes: ['code-1'], user: { email: 'ada@example.com' } },
      });
      const names = response.setCookie.map((line) => line.split('=')[0]);
      expect(names).toEqual(
        expect.arrayContaining([
          GATEWAY_ENV.JWT_ACCESS_NAME,
          GATEWAY_ENV.JWT_REFRESH_NAME,
        ]),
      );
      expect(
        response.setCookie.find((line) =>
          line.startsWith(`${GATEWAY_ENV.JWT_2FA_NAME}=`),
        ),
      ).toMatch(/Max-Age=0|Expires=/);
      // The raw challenge goes to auth-service, which verifies it itself.
      const [call] = peers.auth.calls('TwoFactorAuthService/ActivateTwoFactor');
      expect(call.request).toMatchObject({
        userId: USER,
        code: '123456',
        twoFactorToken: challenge.cookie.slice(
          challenge.cookie.indexOf('=') + 1,
        ),
        deviceName: 'Chrome on macOS',
      });
    },
  );

  rowFor('Two Factor Auth')(
    '**`authenticate` redeems the challenge, clears it, and sets the session cookies**',
    async () => {
      peers.auth.on('TwoFactorAuthService/AuthenticateTwoFactor').reply({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
        user: wireUser(USER),
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/authenticate`,
        { code: '123456' },
        challengeCookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { user: { email: 'ada@example.com' } },
      });
      const names = response.setCookie.map((line) => line.split('=')[0]);
      expect(names).toEqual(
        expect.arrayContaining([
          GATEWAY_ENV.JWT_ACCESS_NAME,
          GATEWAY_ENV.JWT_REFRESH_NAME,
        ]),
      );
      const cleared2fa = response.setCookie.find((line) =>
        line.startsWith(`${GATEWAY_ENV.JWT_2FA_NAME}=`),
      );
      expect(cleared2fa).toMatch(/Max-Age=0|Expires=/);
      const [call] = peers.auth.calls(
        'TwoFactorAuthService/AuthenticateTwoFactor',
      );
      expect(call.request).toMatchObject({ code: '123456' });
    },
  );

  rowFor('Two Factor Auth')(
    '**`authenticate` sets the device-token cookie only when one comes back**',
    async () => {
      peers.auth.on('TwoFactorAuthService/AuthenticateTwoFactor').reply({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
        user: wireUser(USER),
        deviceToken: 'device-tok',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/authenticate`,
        { code: '123456', rememberDevice: true, deviceName: 'Laptop' },
        challengeCookie(),
      );

      expect(response.status).toBe(200);
      expect(
        response.setCookie.some((line) =>
          line.startsWith(`${GATEWAY_ENV.DEVICE_TOKEN_NAME}=device-tok`),
        ),
      ).toBe(true);
    },
  );

  rowFor('Two Factor Auth')(
    '**`authenticate` refuses an access-token cookie — the reverse cross-key rejection**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/authenticate`,
        { code: '123456' },
        accessCookie(),
      );

      expect(response.status).toBe(401);
      expect(
        peers.auth.calls('TwoFactorAuthService/AuthenticateTwoFactor'),
      ).toHaveLength(0);
    },
  );

  rowFor('Two Factor Auth')(
    '**a token signed with the right key but not RS256 is refused, the session and the challenge alike**',
    async () => {
      // RS384 verifies with the same RSA key; only RS256 is issued.
      const challenge = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/authenticate`,
        { code: '123456' },
        challengeCookie(USER, 'RS384'),
      );
      const session = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/setup`,
        undefined,
        accessCookie('RS384'),
      );

      expect([challenge.status, session.status]).toEqual([401, 401]);
      expect(
        peers.auth.calls('TwoFactorAuthService/AuthenticateTwoFactor'),
      ).toHaveLength(0);
      expect(
        peers.auth.calls('TwoFactorAuthService/GenerateTwoFactor'),
      ).toHaveLength(0);
    },
  );

  rowFor('Two Factor Auth')(
    '**`authenticate` refuses a caller with no cookie at all**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/authenticate`,
        { code: '123456' },
        {},
      );

      expect(response.status).toBe(401);
      expect(
        peers.auth.calls('TwoFactorAuthService/AuthenticateTwoFactor'),
      ).toHaveLength(0);
    },
  );

  rowFor('Two Factor Auth')(
    '**`disable` clears the device-token cookie after auth-service un-trusts every device**',
    async () => {
      peers.auth.on('TwoFactorAuthService/DisableTwoFactor').reply({});

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/auth/2fa`,
        {
          body: { code: '123456', password: 'super-secret-1' },
          headers: accessCookie(),
        },
      );

      expect(response.status).toBe(200);
      const cleared = response.setCookie.find((line) =>
        line.startsWith(`${GATEWAY_ENV.DEVICE_TOKEN_NAME}=`),
      );
      expect(cleared).toMatch(/Max-Age=0|Expires=/);
      const [call] = peers.auth.calls('TwoFactorAuthService/DisableTwoFactor');
      expect(call.request).toMatchObject({
        userId: USER,
        code: '123456',
        password: 'super-secret-1',
      });
    },
  );

  rowFor('Two Factor Auth')(
    '**`regenerateBackupCodes` returns a fresh set**',
    async () => {
      peers.auth
        .on('TwoFactorAuthService/RegenerateBackupCodes')
        .reply({ backupCodes: ['new-1', 'new-2', 'new-3'] });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/2fa/backup-codes`,
        { password: 'super-secret-1' },
        accessCookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { backupCodes: ['new-1', 'new-2', 'new-3'] },
      });
    },
  );

  rowFor('Two Factor Auth')(
    '**`getBackupCodesStatus` reports counts only**',
    async () => {
      peers.auth.on('TwoFactorAuthService/GetBackupCodesStatus').reply({
        remaining: 7,
        used: 3,
        expiresAt: { seconds: 1_757_289_600, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/auth/2fa/backup-codes`,
        accessCookie(),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { remaining: 7, used: 3 } });
    },
  );
});
