/**
 * @file `DepartmentsApi` — the writes, membership, and `?includeDeleted`'s
 * query-permission gate: the sharpest row in this file, since a caller
 * without `department.delete` must never be served an entry a privileged
 * caller's `?includeDeleted=true` warmed in the shared cache.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('departments', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  const USER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  const headers = (permissionCodes: string[] = []) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireDepartment = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    name: 'Support',
    description: 'Front line',
    memberCount: 3,
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
    ...overrides,
  });

  const wireUser = (id: string) => ({
    id,
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
    peers.auth.on('OrganizationService/GetOrganizationStatus').always({
      status: toProtoOrgStatus(OrgStatus.ACTIVE),
      deleted: false,
    });
  });

  rowFor('Departments')(
    '**`list` carries the pagination envelope**',
    async () => {
      peers.auth.on('DepartmentService/ListDepartments').reply({
        items: [wireDepartment('d1')],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/departments?page=1&limit=10`,
        headers(['department.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { items: [{ id: 'd1', name: 'Support' }] },
      });
    },
  );

  rowFor('Departments')(
    '**`?includeDeleted=true` without `department.delete` is refused, and never reaches the peer**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/departments?includeDeleted=true`,
        headers(['department.read']),
      );

      expect(response.status).toBe(403);
      expect(
        peers.auth.calls('DepartmentService/ListDepartments'),
      ).toHaveLength(0);
    },
  );

  rowFor('Departments')(
    '**`?includeDeleted=true` WITH `department.delete` reaches the peer with the flag set**',
    async () => {
      peers.auth.on('DepartmentService/ListDepartments').reply({
        items: [
          wireDepartment('d2', {
            deletedAt: { seconds: 1_756_684_800, nanos: 0 },
          }),
        ],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/departments?includeDeleted=true`,
        headers(['department.read', 'department.delete']),
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls('DepartmentService/ListDepartments');
      expect((call.request as { includeDeleted: boolean }).includeDeleted).toBe(
        true,
      );
    },
  );

  rowFor('Departments')(
    '**a cache entry warmed by `?includeDeleted=true` is never served to a caller without the permission**',
    async () => {
      // A tenant of its own: this row's whole point is proving the cache
      // does NOT leak a widened answer, so it must not share an entry with
      // any other row that also lists this tenant's departments.
      const TENANT = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb';
      const privileged = sign(
        {
          sub: USER,
          organizationId: TENANT,
          isSuperAdmin: false,
          departmentIds: [],
          permissionCodes: ['department.read', 'department.delete'],
          isEmailVerified: true,
        },
        TEST_KEYS.access(),
        { algorithm: 'RS256', expiresIn: '15m' },
      );
      const unprivileged = sign(
        {
          sub: USER,
          organizationId: TENANT,
          isSuperAdmin: false,
          departmentIds: [],
          permissionCodes: ['department.read'],
          isEmailVerified: true,
        },
        TEST_KEYS.access(),
        { algorithm: 'RS256', expiresIn: '15m' },
      );

      peers.auth.on('DepartmentService/ListDepartments').reply({
        items: [
          wireDepartment('deleted-1', {
            deletedAt: { seconds: 1_756_684_800, nanos: 0 },
          }),
        ],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const session = new Session(gateway.baseUrl);
      const warmed = await session.get(
        `${API}/departments?includeDeleted=true`,
        {
          cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${privileged}`,
        },
      );
      expect(warmed.status).toBe(200);

      const refused = await session.get(
        `${API}/departments?includeDeleted=true`,
        {
          cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${unprivileged}`,
        },
      );

      expect(refused.status).toBe(403);
    },
  );

  rowFor('Departments')('**`get` returns the department detail**', async () => {
    const id = 'cccccccc-1111-4111-8111-cccccccccccc';
    peers.auth.on('DepartmentService/GetDepartment').reply(wireDepartment(id));

    const response = await new Session(gateway.baseUrl).get(
      `${API}/departments/${id}`,
      headers(['department.read']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { id, name: 'Support' } });
  });

  rowFor('Departments')(
    '**`create` forwards the name and description**',
    async () => {
      peers.auth
        .on('DepartmentService/CreateDepartment')
        .reply(wireDepartment('dddddddd-1111-4111-8111-dddddddddddd'));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/departments`,
        { name: 'Support', description: 'Front line' },
        headers(['department.create']),
      );

      expect(response.status).toBe(201);
      const [call] = peers.auth.calls('DepartmentService/CreateDepartment');
      expect(call.request).toMatchObject({
        name: 'Support',
        description: 'Front line',
      });
    },
  );

  rowFor('Departments')(
    '**`update` sends only the fields present in the body**',
    async () => {
      const id = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
      peers.auth
        .on('DepartmentService/UpdateDepartment')
        .reply(wireDepartment(id, { name: 'Customer Support' }));

      const response = await new Session(gateway.baseUrl).request(
        'PATCH',
        `${API}/departments/${id}`,
        {
          body: { name: 'Customer Support' },
          headers: headers(['department.update']),
        },
      );

      expect(response.status).toBe(200);
      const [call] = peers.auth.calls('DepartmentService/UpdateDepartment');
      expect(call.request).toMatchObject({ id, name: 'Customer Support' });
      expect(call.request).not.toHaveProperty('description');
    },
  );

  rowFor('Departments')(
    '**`remove` answers with the fixed message**',
    async () => {
      const id = 'ffffffff-1111-4111-8111-ffffffffffff';
      peers.auth.on('DepartmentService/DeleteDepartment').reply({});

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/departments/${id}`,
        {
          headers: headers(['department.delete']),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ message: 'Department deleted' });
    },
  );

  rowFor('Departments')(
    '**`restore` answers with the fixed message**',
    async () => {
      const id = '11111111-8888-4888-8888-111111111111';
      peers.auth
        .on('DepartmentService/RestoreDepartment')
        .reply(wireDepartment(id));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/departments/${id}/restore`,
        undefined,
        headers(['department.delete']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ message: 'Department restored' });
    },
  );

  rowFor('Departments')(
    '**`listMembers` nests the full user, flagging `isPrimary`**',
    async () => {
      const id = '22222222-8888-4888-8888-222222222222';
      peers.auth.on('DepartmentService/ListDepartmentMembers').reply({
        items: [
          {
            user: wireUser(USER),
            isPrimary: true,
            assignedAt: { seconds: 1_756_684_800, nanos: 0 },
          },
        ],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/departments/${id}/members`,
        headers(['department.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          items: [
            { user: { id: USER, fullName: 'Ada Lovelace' }, isPrimary: true },
          ],
        },
      });
    },
  );

  rowFor('Departments')(
    '**`addMembers` forwards the user ids and `isPrimary`**',
    async () => {
      const id = '33333333-8888-4888-8888-333333333333';
      peers.auth
        .on('DepartmentService/AddDepartmentMembers')
        .reply({ addedCount: 1, updatedCount: 0 });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/departments/${id}/members`,
        { userIds: [USER], isPrimary: true },
        headers(['department.member.assign']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Members assigned',
        data: { addedCount: 1, updatedCount: 0 },
      });
      const [call] = peers.auth.calls('DepartmentService/AddDepartmentMembers');
      expect(call.request).toMatchObject({
        departmentId: id,
        userIds: [USER],
        isPrimary: true,
      });
    },
  );

  rowFor('Departments')('**`removeMember` sends both ids**', async () => {
    const id = '44444444-8888-4888-8888-444444444444';
    peers.auth.on('DepartmentService/RemoveDepartmentMember').reply({});

    const response = await new Session(gateway.baseUrl).request(
      'DELETE',
      `${API}/departments/${id}/members/${USER}`,
      {
        headers: headers(['department.member.assign']),
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: 'Member removed' });
    const [call] = peers.auth.calls('DepartmentService/RemoveDepartmentMember');
    expect(call.request).toMatchObject({ departmentId: id, userId: USER });
  });
});
