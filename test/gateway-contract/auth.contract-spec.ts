/**
 * @file Authentication, as a client sees it: the cookies, and the caller context the
 * gateway packs onto every peer call.
 *
 * **Cookies are the whole session mechanism here** — the access token is
 * `HttpOnly`, so a row that authenticated with a header would exercise a path
 * no browser takes. Each flag is asserted because each is a decision the Java
 * gateway has to reproduce exactly: a missing `HttpOnly` is an XSS-readable
 * session, and `Max-Age` is a unit trap — the env carries milliseconds and the
 * wire carries SECONDS.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session, parseSetCookie } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('parseSetCookie', () => {
  // Guards the parser itself, not just what the real gateway happens to send —
  // a parser that silently returns `{}` on anything unexpected would make
  // every attribute assertion below pass vacuously.
  it('a line with no `name=` is rejected, not parsed into an empty cookie', () => {
    expect(parseSetCookie('garbage;;;')).toBeNull();
    expect(parseSetCookie('')).toBeNull();
  });

  it('lowercases attribute keys and maps a bare flag to `true`', () => {
    const parsed = parseSetCookie(
      'access_token=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=900',
    );

    expect(parsed).toEqual({
      name: 'access_token',
      value: 'abc',
      attributes: {
        path: '/',
        httponly: true,
        samesite: 'Lax',
        'max-age': '900',
      },
    });
  });
});

describe('authentication', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  /** A token the gateway will actually verify — signed with the tracked key. */
  const accessToken = () =>
    sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes: [],
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const wireUser = () => ({
    id: USER,
    organizationId: ORGANIZATION,
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    isEmailVerified: true,
    isPhoneVerified: false,
    isLocked: false,
    isTwoFactorEnabled: false,
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
    // Every authenticated request asks for it, so an unprogrammed one would
    // turn each row below into a 503 about something else.
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Auth')(
    '**tenant selection is checked BEFORE 2FA**, when a peer response carries both',
    async () => {
      // 2FA policy is a per-tenant setting, so it cannot be evaluated until
      // the tenant is known — `auth.mapper.ts`'s own comment states the
      // order. A response carrying both flags is the only way to observe
      // which branch a gateway checks first; every other fixture in this
      // file sets at most one.
      peers.auth.on('AuthService/Login').reply({
        requiresTwoFactor: true,
        requiresTenantSelection: true,
        tenantSelectionToken: 'tenant-selection-token',
        twoFactorToken: 'two-factor-token',
        tenants: [{ organizationId: ORGANIZATION, name: 'Acme', slug: 'acme' }],
        requiresTwoFactorSetup: false,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/login`,
        { email: 'ada@example.com', password: 'correct horse battery staple' },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { requiresTenantSelection: true },
      });
      expect(response.body).not.toMatchObject({
        data: { requiresTwoFactor: true },
      });
    },
  );

  rowFor('Auth')(
    '**login sets the session cookies**, with the flags a browser enforces',
    async () => {
      peers.auth.on('AuthService/Login').reply({
        requiresTwoFactor: false,
        requiresTenantSelection: false,
        accessToken: accessToken(),
        refreshToken: 'refresh-token',
        tenants: [],
        user: wireUser(),
      });

      const session = new Session(gateway.baseUrl);
      const response = await session.post(`${API}/auth/login`, {
        email: 'ada@example.com',
        password: 'correct horse battery staple',
      });

      expect(response.status).toBe(200);
      expect((response.body as { success: boolean }).success).toBe(true);

      const accessLine = response.setCookie.find((line) =>
        line.startsWith(`${GATEWAY_ENV.JWT_ACCESS_NAME}=`),
      );
      expect(accessLine).toBeDefined();
      const access = parseSetCookie(accessLine!);
      expect(access).not.toBeNull();
      expect(access!.attributes.httponly).toBe(true);
      expect(access!.attributes.path).toBe('/');
      // SameSite's VALUE is case-insensitive on the wire; its presence and
      // its attribute name are not.
      expect(String(access!.attributes.samesite).toLowerCase()).toBe('lax');

      // **Seconds on the wire, milliseconds in the environment.** The conversion
      // is the one the Java binding has to get right, and the refresh cookie's
      // two-hour bug came from exactly this slip.
      expect(access!.attributes['max-age']).toBe(
        String(Number(GATEWAY_ENV.COOKIE_ACCESS_MAX_AGE) / 1000),
      );

      const refreshLine = response.setCookie.find((line) =>
        line.startsWith(`${GATEWAY_ENV.JWT_REFRESH_NAME}=`),
      );
      const refresh = parseSetCookie(refreshLine!);
      expect(refresh).not.toBeNull();
      expect(refresh!.attributes['max-age']).toBe(
        String(Number(GATEWAY_ENV.COOKIE_REFRESH_MAX_AGE) / 1000),
      );
    },
  );

  rowFor('Auth')(
    'the login reached the peer as a real gRPC call, with the credentials',
    async () => {
      peers.auth.on('AuthService/Login').reply({
        requiresTwoFactor: false,
        requiresTenantSelection: false,
        accessToken: accessToken(),
        refreshToken: 'refresh-token',
        tenants: [],
        user: wireUser(),
      });

      await new Session(gateway.baseUrl).post(`${API}/auth/login`, {
        email: 'ada@example.com',
        password: 'correct horse battery staple',
      });

      const [call] = peers.auth.calls('AuthService/Login');
      expect(call.request).toMatchObject({ email: 'ada@example.com' });
    },
  );

  rowFor('Users')(
    '**an authenticated request carries the caller context** on the peer call',
    async () => {
      // What `expect(stubs.user.getCurrentUser).toHaveBeenCalledWith(…)` checked
      // in-process, checked at the network instead — the eight metadata keys are
      // the contract every peer reads, and a Java gateway that packed seven
      // would look correct until a peer applied the wrong tenant filter.
      peers.auth.on('UserService/GetCurrentUser').reply({
        user: wireUser(),
        permissionCodes: ['ticket.read.all'],
        departmentIds: [],
      });

      const session = new Session(gateway.baseUrl);
      const response = await session.get(`${API}/users/me`, {
        cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
        'user-agent': 'contract-harness/1.0',
      });

      expect(response.status).toBe(200);

      const [call] = peers.auth.calls('UserService/GetCurrentUser');
      expect(call.metadata).toMatchObject({
        user_id: USER,
        organization_id: ORGANIZATION,
        is_super_admin: 'false',
        is_email_verified: 'true',
        user_agent: 'contract-harness/1.0',
      });
      expect(call.metadata.ip_address).toBeDefined();
    },
  );

  rowFor('Users')(
    'a request with no cookie is refused before any peer is called',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/me`,
      );

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        success: false,
        statusCode: 401,
        path: `${API}/users/me`,
        error: 'Unauthorized!',
      });
      expect(peers.auth.calls('UserService/GetCurrentUser')).toHaveLength(0);
    },
  );

  rowFor('Users')(
    '**a token signed with the WRONG key is refused**, not merely presence-checked',
    async () => {
      // Same payload shape, same claims, wrong key pair — the 2FA key rather
      // than the access one. A verifier that checked only that a cookie was
      // PRESENT (or that the JWT was well-formed, without checking the
      // signature) would accept this; the access public key must not.
      const forged = sign(
        {
          sub: USER,
          organizationId: ORGANIZATION,
          isSuperAdmin: false,
          departmentIds: [],
          permissionCodes: [],
          isEmailVerified: true,
        },
        TEST_KEYS.twoFactor(),
        { algorithm: 'RS256', expiresIn: '15m' },
      );

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/me`,
        { cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${forged}` },
      );

      expect(response.status).toBe(401);
      expect(peers.auth.calls('UserService/GetCurrentUser')).toHaveLength(0);
    },
  );

  rowFor('Auth')(
    '**logout clears the session cookies** — cleared, not merely absent',
    async () => {
      // No cookie needed: `logout` clears unconditionally, even with nothing
      // server-side to revoke — the caller asked to be logged out and must
      // not keep holding cookies.
      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/logout`,
        {},
      );

      expect(response.status).toBe(200);

      const accessLine = response.setCookie.find((line) =>
        line.startsWith(`${GATEWAY_ENV.JWT_ACCESS_NAME}=`),
      );
      expect(accessLine).toBeDefined();
      const access = parseSetCookie(accessLine!);
      expect(access).not.toBeNull();

      // A clear is an empty value AND an expiry that has already passed —
      // Express writes `Max-Age=0`, Spring's `ResponseCookie` may instead
      // write only a past `Expires`; either is a clear, so both are accepted.
      expect(access!.value).toBe('');
      const maxAgeIsZero = access!.attributes['max-age'] === '0';
      const expiresIsPast =
        typeof access!.attributes.expires === 'string' &&
        new Date(access!.attributes.expires).getTime() < Date.now();
      expect(maxAgeIsZero || expiresIsPast).toBe(true);

      // The clear must match what was SET, or a client that trusted `Path`
      // scoping would keep sending the (now empty) cookie to routes the
      // clear never reached — and a stale `HttpOnly`/`SameSite` divergence
      // is the same shape of bug, one attribute over.
      expect(access!.attributes.path).toBe('/');
      expect(access!.attributes.httponly).toBe(true);
      expect(String(access!.attributes.samesite).toLowerCase()).toBe('lax');
    },
  );
});
