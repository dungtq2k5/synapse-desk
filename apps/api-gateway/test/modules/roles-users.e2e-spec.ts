import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { MAX_ROLE_ASSIGNMENT_USERS } from '../../src/common/config/dto.config';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { grpcError, timestamp } from '../fixtures/wire';

/**
 * `/roles/:id/users` at the HTTP boundary.
 *
 * The inverse direction of `PUT /users/:id/roles`: this adds ONE role to many
 * users rather than replacing one user's whole set.
 */
describe('Role membership at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const roleId = faker.string.uuid();

  const wireRole = (overrides: Record<string, unknown> = {}) => ({
    id: roleId,
    organizationId: faker.string.uuid(),
    name: 'Support Agent',
    description: 'Handles tickets',
    isSystemRole: false,
    userAssigned: 4,
    permissionCodes: [],
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  describe('POST /roles/:id/users', () => {
    it('1. forwards the role and the user ids, and returns the ROLE', async () => {
      // The role carries `userAssigned` — the number the caller's screen shows
      // and the one this just changed.
      fx.stubs.role.assignRoleUsers.mockReturnValue(of(wireRole()));
      const userIds = [faker.string.uuid(), faker.string.uuid()];

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['user.role.assign'],
      })
        .post(`${API}/roles/${roleId}/users`)
        .send({ userIds });

      expect(res.status).toBe(200);
      expect(res.body.data.userAssigned).toBe(4);

      const [[request]] = fx.stubs.role.assignRoleUsers.mock.calls;
      expect(request).toMatchObject({ roleId, userIds });
    });

    it('**2. REFUSES a batch over the cap before reaching the peer**', async () => {
      // Each id costs a role load, a no-escalation check and a current-set read
      // inside one transaction — the bound is load-bearing, not hygiene.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['user.role.assign'],
      })
        .post(`${API}/roles/${roleId}/users`)
        .send({
          userIds: Array.from({ length: MAX_ROLE_ASSIGNMENT_USERS + 1 }, () =>
            faker.string.uuid(),
          ),
        });

      expect(res.status).toBe(400);
      expect(fx.stubs.role.assignRoleUsers).not.toHaveBeenCalled();
    });

    it('3. REJECTS an empty batch and a non-UUID id', async () => {
      const agent = () =>
        authenticatedAgent(fx.app, { permissionCodes: ['user.role.assign'] });

      await agent()
        .post(`${API}/roles/${roleId}/users`)
        .send({ userIds: [] })
        .expect(400);
      await agent()
        .post(`${API}/roles/${roleId}/users`)
        .send({ userIds: ['not-a-uuid'] })
        .expect(400);

      expect(fx.stubs.role.assignRoleUsers).not.toHaveBeenCalled();
    });

    it('**4. `role.read` is not enough — assigning roles is a grant**', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['role.read'],
      })
        .post(`${API}/roles/${roleId}/users`)
        .send({ userIds: [faker.string.uuid()] });

      expect(res.status).toBe(403);
      expect(fx.stubs.role.assignRoleUsers).not.toHaveBeenCalled();
    });

    it('5. a cross-tenant user id surfaces as 404, whole', async () => {
      fx.stubs.role.assignRoleUsers.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'Unknown user(s): abc'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['user.role.assign'],
      })
        .post(`${API}/roles/${roleId}/users`)
        .send({ userIds: [faker.string.uuid()] });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /roles/:id/users/:userId', () => {
    it('6. forwards both ids and returns the role', async () => {
      fx.stubs.role.revokeRoleUser.mockReturnValue(
        of(wireRole({ userAssigned: 3 })),
      );
      const userId = faker.string.uuid();

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['user.role.assign'],
      }).delete(`${API}/roles/${roleId}/users/${userId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.userAssigned).toBe(3);

      const [[request]] = fx.stubs.role.revokeRoleUser.mock.calls;
      expect(request).toMatchObject({ roleId, userId });
    });

    it('**7. demoting the last Org Admin surfaces as 409, not 500**', async () => {
      // The service refuses with ABORTED, which the code table maps to CONFLICT
      // — a state problem the caller can act on, not an internal error.
      fx.stubs.role.revokeRoleUser.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.ABORTED,
            'This is the last active Org Admin. Promote another before removing this one.',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['user.role.assign'],
      }).delete(`${API}/roles/${roleId}/users/${faker.string.uuid()}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('last active Org Admin');
    });

    it('8. REJECTS a non-UUID user id before reaching the peer', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['user.role.assign'],
      }).delete(`${API}/roles/${roleId}/users/not-a-uuid`);

      expect(res.status).toBe(400);
      expect(fx.stubs.role.revokeRoleUser).not.toHaveBeenCalled();
    });
  });
});
