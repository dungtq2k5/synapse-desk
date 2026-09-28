/**
 * @file `role`, `roles`, `permissions`, `Role.permissions`, `me`, `user`,
 * `users`, and `User.departments`.
 *
 * `Role.permissions` is where the tenant-keyed loader gets its first real
 * row: N roles on the SAME tenant resolving it make exactly ONE
 * `RoleService/ListPermissions` call, not N — the property
 * `PermissionCatalogueLoaderConfig` exists for.
 */

import { status as GrpcStatus } from '@grpc/grpc-js';
import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowForField } from './pending';

describe('roles and users', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = '11111111-1111-4111-8111-111111111111';
  const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const headers = (
    permissionCodes: string[] = [],
    organizationId = ORGANIZATION,
  ) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireRole = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: 'Agent',
    description: 'Front line',
    isSystemRole: false,
    userAssigned: 3,
    permissionCodes: ['ticket.read'],
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const wirePermission = (
    code: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: `perm-${code}`,
    code,
    name: code,
    group: code.split('.')[0],
    isRetired: false,
    ...overrides,
  });

  const wireUser = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    organizationId: ORGANIZATION,
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    isEmailVerified: true,
    isPhoneVerified: false,
    gender: 2, // GENDER_FEMALE
    isLocked: false,
    isTwoFactorEnabled: false,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const page = (itemCount: number) => ({
    totalItems: itemCount,
    itemCount,
    itemsPerPage: itemCount,
    totalPages: 1,
    currentPage: 1,
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

  describe('Roles', () => {
    rowForField('Query.role')(
      '**`Query.role` resolves one role**',
      async () => {
        const id = '55555555-5555-4555-8555-555555555555';
        peers.auth.on('RoleService/GetRole').reply(wireRole(id));

        const response = await new Session(gateway.baseUrl).post<{
          data: { role: { id: string; name: string; userAssigned: number } };
        }>(
          '/graphql',
          { query: `{ role(id: "${id}") { id name userAssigned } }` },
          headers(['role.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.role).toEqual({
          id,
          name: 'Agent',
          userAssigned: 3,
        });
      },
    );

    rowForField('Query.role')(
      '**`Query.role` answers null, never an error, when the peer refuses**',
      async () => {
        peers.auth
          .on('RoleService/GetRole')
          .fail(GrpcStatus.NOT_FOUND, 'no such role');

        const response = await new Session(gateway.baseUrl).post<{
          data: { role: null };
        }>(
          '/graphql',
          {
            query:
              '{ role(id: "66666666-6666-4666-8666-666666666666") { id } }',
          },
          headers(['role.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.role).toBeNull();
      },
    );

    rowForField('Query.roles')(
      '**`Query.roles` never asks for system roles**',
      async () => {
        peers.auth
          .on('RoleService/ListRoles')
          .reply({ items: [wireRole('r1')], meta: page(1) });

        const response = await new Session(gateway.baseUrl).post<{
          data: { roles: { items: { id: string }[] } };
        }>(
          '/graphql',
          { query: '{ roles(first: 10, page: 1) { items { id } } }' },
          headers(['role.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');

        const [call] = peers.auth.calls('RoleService/ListRoles');
        expect((call.request as { includeSystem: boolean }).includeSystem).toBe(
          false,
        );
      },
    );

    rowForField('Query.permissions')(
      '**`Query.permissions` returns the whole catalogue, including retired codes**',
      async () => {
        peers.auth.on('RoleService/ListPermissions').reply({
          items: [
            wirePermission('ticket.read'),
            wirePermission('ticket.write', { isRetired: true }),
          ],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: { permissions: { code: string; isRetired: boolean }[] };
        }>(
          '/graphql',
          { query: '{ permissions { code isRetired } }' },
          headers(['role.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.permissions).toEqual([
          { code: 'ticket.read', isRetired: false },
          { code: 'ticket.write', isRetired: true },
        ]);
      },
    );

    rowForField('Query.roles')(
      '**10 roles on one tenant resolving `permissions` make exactly ONE `ListPermissions` call**',
      async () => {
        // A tenant of its own: the catalogue loader caches by organization id
        // for an hour, and the `Query.permissions` row above already warmed
        // `ORGANIZATION`'s entry — sharing it here would prove the cache, not
        // the loader's batch-of-one property this row exists to prove.
        const TENANT = '22222222-2222-4222-8222-222222222222';

        peers.auth.on('RoleService/ListRoles').reply({
          items: Array.from({ length: 10 }, (_, index) =>
            wireRole(`role-${index}`, { permissionCodes: ['ticket.read'] }),
          ),
          meta: page(10),
        });
        peers.auth.on('RoleService/ListPermissions').reply({
          items: [
            wirePermission('ticket.read'),
            wirePermission('ticket.write'),
          ],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: { roles: { items: { permissions: { code: string }[] }[] } };
        }>(
          '/graphql',
          {
            query:
              '{ roles(first: 10, page: 1) { items { permissions { code } } } }',
          },
          headers(['role.read'], TENANT),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.roles.items).toHaveLength(10);
        for (const role of response.body.data.roles.items) {
          expect(role.permissions).toEqual([{ code: 'ticket.read' }]);
        }
        expect(peers.auth.calls('RoleService/ListPermissions')).toHaveLength(1);
      },
    );
  });

  describe('Users', () => {
    rowForField('Query.me')(
      '**`Query.me` flattens the current-user envelope — `departmentIds` is a sibling of `user`, not dropped**',
      async () => {
        peers.auth.on('UserService/GetCurrentUser').reply({
          user: wireUser(USER),
          permissionCodes: [],
          departmentIds: ['dept-1', 'dept-2'],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: { me: { id: string; departmentIds: string[]; gender: string } };
        }>(
          '/graphql',
          { query: '{ me { id departmentIds gender } }' },
          headers(),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.me).toEqual({
          id: USER,
          departmentIds: ['dept-1', 'dept-2'],
          gender: 'FEMALE',
        });
      },
    );

    rowForField('Query.user')(
      '**`Query.user` flattens the summary envelope**',
      async () => {
        const id = '77777777-7777-4777-8777-777777777777';
        peers.auth.on('UserService/GetUser').reply({
          user: wireUser(id),
          roleIds: [],
          roleNames: [],
          departmentIds: ['dept-1'],
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: { user: { id: string; departmentIds: string[] } };
        }>(
          '/graphql',
          { query: `{ user(id: "${id}") { id departmentIds } }` },
          headers(['user.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.user).toEqual({
          id,
          departmentIds: ['dept-1'],
        });
      },
    );

    rowForField('Query.user')(
      '**`Query.user` answers null, never an error, when the peer refuses**',
      async () => {
        peers.auth
          .on('UserService/GetUser')
          .fail(GrpcStatus.NOT_FOUND, 'no such user');

        const response = await new Session(gateway.baseUrl).post<{
          data: { user: null };
        }>(
          '/graphql',
          {
            query:
              '{ user(id: "88888888-8888-4888-8888-888888888888") { id } }',
          },
          headers(['user.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.user).toBeNull();
      },
    );

    rowForField('Query.users')(
      '**`Query.users` never asks for deleted users**',
      async () => {
        peers.auth.on('UserService/ListUsers').reply({
          items: [
            {
              user: wireUser('u1'),
              roleIds: [],
              roleNames: [],
              departmentIds: [],
            },
          ],
          meta: page(1),
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: { users: { items: { id: string }[] } };
        }>(
          '/graphql',
          { query: '{ users(first: 10, page: 1) { items { id } } }' },
          headers(['user.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');

        const [call] = peers.auth.calls('UserService/ListUsers');
        expect(
          (call.request as { includeDeleted: boolean }).includeDeleted,
        ).toBe(false);
      },
    );

    rowForField('Query.user')(
      '**`User.departments` truncates at MAX_EDGE_LIST, `departmentCount` reports the true total**',
      async () => {
        const id = '99999999-9999-4999-8999-999999999999';
        const MAX_EDGE_LIST = 50;
        const departmentIds = Array.from(
          { length: 251 },
          (_, index) =>
            `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
        );
        peers.auth.on('UserService/GetUser').reply({
          user: wireUser(id),
          roleIds: [],
          roleNames: [],
          departmentIds,
        });
        peers.auth.on('DepartmentService/ListDepartmentsByIds').reply({
          items: departmentIds.slice(0, MAX_EDGE_LIST).map((deptId) => ({
            id: deptId,
            name: `Department ${deptId.slice(0, 8)}`,
            description: undefined,
          })),
        });

        const response = await new Session(gateway.baseUrl).post<{
          data: {
            user: { departments: { id: string }[]; departmentCount: number };
          };
        }>(
          '/graphql',
          {
            query: `{ user(id: "${id}") { departments { id } departmentCount } }`,
          },
          headers(['user.read']),
        );

        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('errors');
        expect(response.body.data.user.departments).toHaveLength(MAX_EDGE_LIST);
        expect(response.body.data.user.departmentCount).toBe(251);

        const [call] = peers.auth.calls(
          'DepartmentService/ListDepartmentsByIds',
        );
        expect(
          (call.request as { departmentIds: string[] }).departmentIds,
        ).toHaveLength(MAX_EDGE_LIST);
      },
    );
  });
});
