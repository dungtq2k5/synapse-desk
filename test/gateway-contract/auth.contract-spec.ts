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
import { status as GrpcStatus } from '@grpc/grpc-js';
import { OrgStatus } from '@synapsedesk/contracts';
import { withErrorDetails } from '@synapsedesk/core';
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
    '**a frozen organization’s sign-in** is a 403 in auth’s words, with the status as `details`',
    async () => {
      peers.auth
        .on('AuthService/Login')
        .fail(
          GrpcStatus.PERMISSION_DENIED,
          withErrorDetails(
            "This organization can't be opened. Contact support to restore access",
            { organizationStatus: OrgStatus.FROZEN },
          ),
        );

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/login`,
        { email: 'ada@example.com', password: 'correct horse battery staple' },
      );

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error:
          "This organization can't be opened. Contact support to restore access!",
        details: { organizationStatus: OrgStatus.FROZEN },
      });
    },
  );

  rowFor('Users')(
    '**`/users/me` says the organization’s status, and null for a Super Admin**',
    async () => {
      const me = async (organizationStatus: number) => {
        peers.auth.on('UserService/GetCurrentUser').reply({
          user: wireUser(),
          permissionCodes: [],
          departmentIds: [],
          hasPassword: true,
          organizationStatus,
        });
        return new Session(gateway.baseUrl).get(`${API}/users/me`, {
          cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
        });
      };

      const pastDue = await me(toProtoOrgStatus(OrgStatus.SUSPENDED_PAST_DUE));
      expect(pastDue.status).toBe(200);
      expect(pastDue.body).toMatchObject({
        data: { organizationStatus: OrgStatus.SUSPENDED_PAST_DUE },
      });

      const none = await me(toProtoOrgStatus(null));
      expect(none.body).toMatchObject({ data: { organizationStatus: null } });
    },
  );

  rowFor('Users')('**`/users/me` says who is a Super Admin**', async () => {
    peers.auth.on('UserService/GetCurrentUser').reply({
      user: wireUser(),
      permissionCodes: [],
      departmentIds: [],
      hasPassword: true,
      isSuperAdmin: true,
    });

    const response = await new Session(gateway.baseUrl).get(`${API}/users/me`, {
      cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { isSuperAdmin: true } });
  });

  rowFor('Auth')(
    '**the two-step challenge says whether the device may be remembered**',
    async () => {
      peers.auth.on('AuthService/Login').reply({
        requiresTwoFactor: true,
        twoFactorToken: 'two-factor-token',
        requiresTwoFactorSetup: false,
        canRememberDevice: false,
      });

      // Its own account: the login tier allows five per (address, account),
      // and every suite on this Redis shares Ada's.
      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/login`,
        {
          email: 'remember@example.com',
          password: 'correct horse battery staple',
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          requiresTwoFactor: true,
          requiresTwoFactorSetup: false,
          canRememberDevice: false,
        },
      });
    },
  );

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
    '**register answers the address and that it needs verifying, never an id**',
    async () => {
      // auth-service leaves the ids empty so a taken address answers as a new
      // one does; the gateway doesn't publish them even when a peer sends them.
      peers.auth.on('AuthService/Register').reply({
        userId: 'user-1',
        organizationId: ORGANIZATION,
        email: 'ada@example.com',
        requiresEmailVerification: true,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/auth/register`,
        {
          email: 'ada@example.com',
          password: 'Str0ng!Passw0rd',
          fullName: 'Ada Lovelace',
        },
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        data: { email: 'ada@example.com', requiresEmailVerification: true },
      });
      expect(
        Object.keys((response.body as { data: object }).data).sort(),
      ).toEqual(['email', 'requiresEmailVerification']);
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

  rowFor('Auth')(
    "**the caller's IP is the rightmost `X-Forwarded-For` entry**: the one the trusted hop appended",
    async () => {
      // Exactly one proxy hop (the Ingress) is trusted, and it appends the
      // address it saw; everything to the left of that entry is whatever the
      // client wrote. The device session, the audit trail and IP lockout all
      // read this value from the metadata.
      peers.auth.on('AuthService/Login').reply({
        requiresTwoFactor: false,
        requiresTenantSelection: false,
        accessToken: accessToken(),
        refreshToken: 'refresh-token',
        tenants: [],
        user: wireUser(),
      });

      await new Session(gateway.baseUrl).post(
        `${API}/auth/login`,
        { email: 'ada@example.com', password: 'correct horse battery staple' },
        { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' },
      );

      const [call] = peers.auth.calls('AuthService/Login');
      expect(call.metadata.ip_address).toBe('203.0.113.9');
    },
  );

  rowFor('Users')(
    '**the current user says whether a password exists**, both ways, and never the hash',
    async () => {
      const session = new Session(gateway.baseUrl);
      const me = async (hasPassword: boolean) => {
        peers.auth.on('UserService/GetCurrentUser').reply({
          user: wireUser(),
          permissionCodes: [],
          departmentIds: [],
          hasPassword,
        });
        return session.get(`${API}/users/me`, {
          cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken()}`,
        });
      };

      for (const hasPassword of [true, false]) {
        const response = await me(hasPassword);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ data: { hasPassword } });
        expect(JSON.stringify(response.body)).not.toMatch(/passwordHash/i);
      }
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
