/**
 * @file `RolesApi` — the writes, `get`, and the list route's cache reuse.
 * `api.contract-spec.ts` already covers list's pagination envelope and the
 * page-bounds 400, so this file does not repeat them.
 */

import { sign } from 'jsonwebtoken';
import { OrgStatus } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('roles', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const USER = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';

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

  const wireRole = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: 'Agent',
    description: 'Front line',
    isSystemRole: false,
    userAssigned: 3,
    permissionCodes: ['ticket.read.all'],
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
    updatedAt: { seconds: 1_756_684_800, nanos: 0 },
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

  rowFor('Roles')(
    '**a second `list` call with the same query never reaches the peer within the TTL**',
    async () => {
      peers.auth
        .on('RoleService/ListRoles')
        .reply({ items: [wireRole('r1')], meta: { totalItems: 1, itemCount: 1, itemsPerPage: 10, totalPages: 1, currentPage: 1 } });

      const session = new Session(gateway.baseUrl);
      const first = await session.get(`${API}/roles?page=1&limit=10`, headers(['role.read']));
      const second = await session.get(`${API}/roles?page=1&limit=10`, headers(['role.read']));

      expect(first.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(peers.auth.calls('RoleService/ListRoles')).toHaveLength(1);
    },
  );

  rowFor('Roles')('**`get` returns the role detail**', async () => {
    const id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
    peers.auth.on('RoleService/GetRole').reply(wireRole(id));

    const response = await new Session(gateway.baseUrl).get(`${API}/roles/${id}`, headers(['role.read']));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: { id, name: 'Agent', userAssigned: 3 } });
  });

  rowFor('Roles')('**`create` forwards the name, description and permission codes**', async () => {
    peers.auth.on('RoleService/CreateRole').reply(wireRole('cccccccc-1111-4111-8111-cccccccccccc'));

    const response = await new Session(gateway.baseUrl).post(
      `${API}/roles`,
      { name: 'Agent', description: 'Front line', permissionCodes: ['ticket.read.all'] },
      headers(['role.create']),
    );

    expect(response.status).toBe(201);
    const [call] = peers.auth.calls('RoleService/CreateRole');
    expect(call.request).toMatchObject({
      name: 'Agent',
      description: 'Front line',
      permissionCodes: ['ticket.read.all'],
    });
  });

  rowFor('Roles')('**`update` sends only the fields present in the body**', async () => {
    const id = 'dddddddd-1111-4111-8111-dddddddddddd';
    peers.auth.on('RoleService/UpdateRole').reply(wireRole(id, { name: 'Senior Agent' }));

    const response = await new Session(gateway.baseUrl).request('PATCH', `${API}/roles/${id}`, {
      body: { name: 'Senior Agent' },
      headers: headers(['role.update']),
    });

    expect(response.status).toBe(200);
    const [call] = peers.auth.calls('RoleService/UpdateRole');
    expect(call.request).toMatchObject({ id, name: 'Senior Agent' });
    expect(call.request).not.toHaveProperty('description');
  });

  rowFor('Roles')('**`remove` answers with the fixed message**', async () => {
    const id = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
    peers.auth.on('RoleService/DeleteRole').reply({});

    const response = await new Session(gateway.baseUrl).request('DELETE', `${API}/roles/${id}`, {
      headers: headers(['role.delete']),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: 'Role deleted' });
    const [call] = peers.auth.calls('RoleService/DeleteRole');
    expect(call.request).toMatchObject({ id });
  });

  rowFor('Roles')('**`setPermissions` replaces the whole set**', async () => {
    const id = 'ffffffff-1111-4111-8111-ffffffffffff';
    peers.auth.on('RoleService/SetRolePermissions').reply(wireRole(id, { permissionCodes: ['role.read'] }));

    const response = await new Session(gateway.baseUrl).request('PUT', `${API}/roles/${id}/permissions`, {
      body: { permissionCodes: ['role.read'] },
      headers: headers(['role.permission.assign']),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: 'Permissions updated' });
    const [call] = peers.auth.calls('RoleService/SetRolePermissions');
    expect(call.request).toMatchObject({ id, permissionCodes: ['role.read'] });
  });

  rowFor('Roles')('**`assignUsers` sends the role id and every user id**', async () => {
    const id = '11111111-9999-4999-8999-111111111111';
    const u1 = '22222222-9999-4999-8999-222222222222';
    peers.auth.on('RoleService/AssignRoleUsers').reply(wireRole(id, { userAssigned: 4 }));

    const response = await new Session(gateway.baseUrl).post(
      `${API}/roles/${id}/users`,
      { userIds: [u1] },
      headers(['user.role.assign']),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: 'Role assigned' });
    const [call] = peers.auth.calls('RoleService/AssignRoleUsers');
    expect(call.request).toMatchObject({ roleId: id, userIds: [u1] });
  });

  rowFor('Roles')('**`revokeUser` sends both ids**', async () => {
    const id = '33333333-9999-4999-8999-333333333333';
    const userId = '44444444-9999-4999-8999-444444444444';
    peers.auth.on('RoleService/RevokeRoleUser').reply(wireRole(id, { userAssigned: 2 }));

    const response = await new Session(gateway.baseUrl).request(
      'DELETE',
      `${API}/roles/${id}/users/${userId}`,
      { headers: headers(['user.role.assign']) },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: 'Role revoked' });
    const [call] = peers.auth.calls('RoleService/RevokeRoleUser');
    expect(call.request).toMatchObject({ roleId: id, userId });
  });
});
