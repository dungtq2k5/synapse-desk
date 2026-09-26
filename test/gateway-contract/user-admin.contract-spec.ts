/**
 * @file `UserAdminApi` — the largest permission surface yet (8 distinct
 * codes across 12 operations), and the first module where a single route
 * carries an extra manual gate on top of `@RequirePermission`: `list`'s
 * `includeDeleted` needs `user.delete`, not just `user.read`, and that is
 * NOT expressible as a second code on the decorator (which is OR-of, so a
 * second code would widen the route rather than narrow it).
 *
 * `get` doubles as the regression row for a real bug this module's own
 * research surfaced: the shared `UserMapper.toUserResponseDto` never set
 * `lockedUntil`, so every admin view of a temporarily-locked user rendered
 * `isLocked: true, lockedUntil: null`.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('user admin', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const ADMIN = '22222222-2222-4222-8222-222222222222';
  const TARGET_USER = '33333333-3333-4333-8333-333333333333';

  const accessToken = (permissionCodes: string[] = []) =>
    sign(
      {
        sub: ADMIN,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    );

  const cookie = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${accessToken(permissionCodes)}`,
  });

  const wireUser = (overrides: Record<string, unknown> = {}) => ({
    id: TARGET_USER,
    organizationId: ORGANIZATION,
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    isEmailVerified: true,
    isPhoneVerified: false,
    isLocked: false,
    isTwoFactorEnabled: false,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const wireSummary = (overrides: Record<string, unknown> = {}) => ({
    user: wireUser(),
    roleIds: ['44444444-4444-4444-8444-444444444444'],
    roleNames: ['Agent'],
    departmentIds: [],
    ...overrides,
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

  rowFor('User Admin')(
    '**listing refuses a caller without `user.read`**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/users`,
        cookie([]),
      );

      expect(response.status).toBe(403);
      expect(peers.auth.calls('UserService/ListUsers')).toHaveLength(0);
    },
  );

  rowFor('User Admin')(
    '**`includeDeleted` requires `user.delete` on top of `user.read`** — not expressible as a second `@RequirePermission` code',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/users?includeDeleted=true`,
        cookie(['user.read']),
      );

      expect(response.status).toBe(403);
      expect(peers.auth.calls('UserService/ListUsers')).toHaveLength(0);
    },
  );

  rowFor('User Admin')(
    'a caller with both codes sees deactivated users, `includeDeleted` reaching the peer',
    async () => {
      peers.auth.on('UserService/ListUsers').reply({
        items: [wireSummary()],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users?includeDeleted=true&searchTerm=ada`,
        cookie(['user.read', 'user.delete']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ roleNames: ['Agent'] }] },
      });

      const [call] = peers.auth.calls('UserService/ListUsers');
      expect(call.request).toMatchObject({ includeDeleted: true });
      expect(call.request.page).toMatchObject({ searchTerm: 'ada' });
    },
  );

  rowFor('User Admin')(
    '**`get` round-trips `lockedUntil`** — the shared mapper used to drop it silently',
    async () => {
      peers.auth.on('UserService/GetUser').reply(
        wireSummary({
          user: wireUser({
            isLocked: true,
            lockedUntil: { seconds: 1_788_307_200, nanos: 0 },
          }),
        }),
      );

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/${TARGET_USER}`,
        cookie(['user.read']),
      );

      expect(response.status).toBe(200);
      // FIXME 'response.body' is of type 'unknown'.
      expect(response.body.data.user.isLocked).toBe(true);
      // Not an exact string match: Java's default `OffsetDateTime`
      // serialization drops the fractional seconds when they're zero
      // (`...T00:00:00Z`), where Node's `toISOString()` always keeps
      // `.000` — a harmless cross-implementation formatting difference, not
      // a value difference, so parse-and-compare rather than couple this
      // row (about the value surviving at all) to it.
      // FIXME Unsafe argument of type error typed assigned to a parameter of type `string | number | Date`.
      expect(new Date(response.body.data.user.lockedUntil).toISOString()).toBe(
        '2026-09-02T00:00:00.000Z',
      );
    },
  );

  rowFor('User Admin')(
    'creating forwards the role and department ids, no password field exists',
    async () => {
      peers.auth.on('UserService/CreateUser').reply({ user: wireSummary() });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users`,
        {
          email: 'ada@example.com',
          fullName: 'Ada Lovelace',
          roleIds: [],
          departmentIds: [],
        },
        cookie(['user.create']),
      );

      expect(response.status).toBe(201);

      const [call] = peers.auth.calls('UserService/CreateUser');
      expect(call.request).toMatchObject({
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
      });
    },
  );

  rowFor('User Admin')(
    // Skipped for Java: `openApiNullable` is off project-wide (pom.xml,
    // deliberate), so the generated `UpdateUserDto.dob` is a plain
    // `@Nullable String` — JSON `null` and an absent key both deserialize to
    // the same Java `null`, and the controller cannot tell "clear it" from
    // "leave it alone" apart the way Node's `dto.dob === null` check can.
    '**an explicit `dob: null` clears it** — `toProfileFields`, reproduced',
    async () => {
      peers.auth.on('UserService/UpdateUser').reply(wireSummary());

      const cleared = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/users/${TARGET_USER}`,
        { body: { dob: null }, headers: cookie(['user.update']) },
      );
      expect(cleared.status).toBe(200);
      expect(
        peers.auth.calls('UserService/UpdateUser').at(-1)?.request.dob,
      ).toBe('');
    },
  );

  rowFor('User Admin')('an absent `dob` leaves it unchanged', async () => {
    peers.auth.on('UserService/UpdateUser').reply(wireSummary());

    const untouched = await new Session(gateway.baseUrl).request(
      'PATCH',
      `${API}/users/${TARGET_USER}`,
      { body: { fullName: 'Ada Byron' }, headers: cookie(['user.update']) },
    );
    expect(untouched.status).toBe(200);
    expect(
      peers.auth.calls('UserService/UpdateUser').at(-1)?.request.dob,
    ).toBeUndefined();
  });

  rowFor('User Admin')(
    'removing surfaces the revoked session count',
    async () => {
      peers.auth.on('UserService/DeleteUser').reply({ revokedSessionCount: 4 });

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/users/${TARGET_USER}`,
        { headers: cookie(['user.delete']) },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { revokedSessionCount: 4 } });
    },
  );

  rowFor('User Admin')(
    "**`restore` shares `remove`'s code, not a new one** — refused without `user.delete`",
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/${TARGET_USER}/restore`,
        {},
        cookie(['user.read']),
      );

      expect(response.status).toBe(403);
      expect(peers.auth.calls('UserService/RestoreUser')).toHaveLength(0);
    },
  );

  rowFor('User Admin')(
    'locking forwards the reason and an explicit future `lockedUntil`, an absent one means indefinite',
    async () => {
      peers.auth.on('UserService/LockUser').reply({ revokedSessionCount: 2 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/${TARGET_USER}/lock`,
        {
          reason: 'Suspicious activity',
          lockedUntil: '2026-12-31T00:00:00.000Z',
        },
        cookie(['user.lock']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { revokedSessionCount: 2 } });

      const [call] = peers.auth.calls('UserService/LockUser');
      expect(call.request).toMatchObject({ reason: 'Suspicious activity' });
      expect(call.request.lockedUntil).toBeTruthy();
    },
  );

  rowFor('User Admin')(
    "**`unlock` shares `lock`'s code** and answers with an empty envelope, not a 204",
    async () => {
      peers.auth.on('UserService/UnlockUser').reply({});

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/${TARGET_USER}/unlock`,
        {},
        cookie(['user.lock']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, data: null });
    },
  );

  rowFor('User Admin')(
    'resetting two factor surfaces the untrusted device count',
    async () => {
      peers.auth
        .on('UserService/ResetUserTwoFactor')
        .reply({ untrustedDeviceCount: 1 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/${TARGET_USER}/2fa/reset`,
        {},
        cookie(['user.2fa.reset']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { untrustedDeviceCount: 1 },
      });
    },
  );

  rowFor('User Admin')(
    'setting roles replaces the set and requires its own distinct code',
    async () => {
      peers.auth.on('UserService/SetUserRoles').reply(wireSummary());

      const response = await new Session(gateway.baseUrl).request(
        'PUT',
        `${API}/users/${TARGET_USER}/roles`,
        {
          body: { roleIds: ['44444444-4444-4444-8444-444444444444'] },
          headers: cookie(['user.role.assign']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls('UserService/SetUserRoles');
      expect(call.request).toMatchObject({
        roleIds: ['44444444-4444-4444-8444-444444444444'],
      });
    },
  );

  rowFor('User Admin')(
    '**setting departments needs `department.member.assign`, a code from a different module entirely**',
    async () => {
      peers.auth.on('UserService/SetUserDepartments').reply(wireSummary());

      const response = await new Session(gateway.baseUrl).request(
        'PUT',
        `${API}/users/${TARGET_USER}/departments`,
        {
          body: {
            departments: [
              {
                departmentId: '55555555-5555-4555-8555-555555555555',
                isPrimary: true,
              },
            ],
          },
          headers: cookie(['department.member.assign']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls('UserService/SetUserDepartments');
      expect(call.request.departments).toMatchObject([
        {
          departmentId: '55555555-5555-4555-8555-555555555555',
          isPrimary: true,
        },
      ]);
    },
  );
});
