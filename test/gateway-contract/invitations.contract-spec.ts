/**
 * @file `InvitationsApi` — two of the eight routes are genuinely public
 * (`previewByToken`, `accept`), and `accept` additionally needs the
 * `GuestGuard` property: signing in while already holding a live session
 * must be refused before the peer is ever dialed. `create`/`resend` are the
 * first routes in this port to need `EmailVerifiedGuard`.
 */

import { sign } from 'jsonwebtoken';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { API, Session } from './client';
import { type Gateway, GATEWAY_ENV, startGateway } from './gateway';
import { type Peers, startPeers, TEST_KEYS } from './peers';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('invitations', () => {
  let gateway: Gateway;
  let peers: Peers;

  const ORGANIZATION = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
  const USER = 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee';

  const headers = (permissionCodes: string[] = [], isEmailVerified = true) => ({
    cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
      {
        sub: USER,
        organizationId: ORGANIZATION,
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified,
      },
      TEST_KEYS.access(),
      { algorithm: 'RS256', expiresIn: '15m' },
    )}`,
  });

  const wireInvitation = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    email: 'invitee@example.com',
    status: 'INVITATION_STATUS_PENDING',
    roleIds: [],
    departmentIds: [],
    resentCount: 0,
    lastSentAt: { seconds: 1_756_684_800, nanos: 0 },
    expiresAt: { seconds: 1_757_289_600, nanos: 0 },
    createdAt: { seconds: 1_756_684_800, nanos: 0 },
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

  rowFor('Invitations')(
    '**`create` forwards the batch and returns 201 when all succeed**',
    async () => {
      peers.auth.on('InvitationService/CreateInvitations').reply({
        created: [wireInvitation('i1')],
        failed: [],
        batchId: 'batch-1',
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations`,
        {
          invitations: [
            { email: 'invitee@example.com', roleIds: [], departmentIds: [] },
          ],
        },
        headers(['user.invite']),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        data: { created: [{ id: 'i1' }], batchId: 'batch-1' },
      });
      const [call] = peers.auth.calls('InvitationService/CreateInvitations');
      expect(call.request).toMatchObject({
        organizationId: ORGANIZATION,
        invitedById: USER,
      });
    },
  );

  rowFor('Invitations')(
    '**`create` answers 207 with a warning when any address fails**',
    async () => {
      peers.auth.on('InvitationService/CreateInvitations').reply({
        created: [wireInvitation('i2')],
        failed: [{ email: 'bad@example.com', reason: 'already a member' }],
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations`,
        {
          invitations: [
            { email: 'invitee@example.com', roleIds: [], departmentIds: [] },
            { email: 'bad@example.com', roleIds: [], departmentIds: [] },
          ],
        },
        headers(['user.invite']),
      );

      expect(response.status).toBe(207);
      expect(response.body).toMatchObject({
        warning: '1 invitation(s) could not be created',
        data: {
          failed: [{ email: 'bad@example.com', reason: 'already a member' }],
        },
      });
    },
  );

  rowFor('Invitations')(
    '**`create` refuses an unverified inviter before dialing the peer**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations`,
        {
          invitations: [
            { email: 'invitee@example.com', roleIds: [], departmentIds: [] },
          ],
        },
        headers(['user.invite'], false),
      );

      expect(response.status).toBe(403);
      expect(
        peers.auth.calls('InvitationService/CreateInvitations'),
      ).toHaveLength(0);
    },
  );

  rowFor('Invitations')(
    '**`list` forwards the status filter and carries the pagination envelope**',
    async () => {
      peers.auth.on('InvitationService/ListInvitations').reply({
        items: [wireInvitation('i3')],
        meta: {
          totalItems: 1,
          itemCount: 1,
          itemsPerPage: 10,
          totalPages: 1,
          currentPage: 1,
        },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/invitations?page=1&limit=10&status=PENDING`,
        headers(['user.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { items: [{ id: 'i3' }] } });
      const [call] = peers.auth.calls('InvitationService/ListInvitations');
      expect(call.request).toMatchObject({ status: 1 }); // INVITATION_STATUS_PENDING
    },
  );

  rowFor('Invitations')(
    '**`list` refuses an unrecognized `status` value**',
    async () => {
      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/invitations?status=BOGUS`,
        headers(['user.read']),
      );

      expect(response.status).toBe(400);
      expect(
        peers.auth.calls('InvitationService/ListInvitations'),
      ).toHaveLength(0);
    },
  );

  rowFor('Invitations')(
    '**`resend` rotates the token and answers with the fixed message**',
    async () => {
      const id = 'ffffffff-1111-4111-8111-ffffffffffff';
      peers.auth
        .on('InvitationService/ResendInvitation')
        .reply(wireInvitation(id, { resentCount: 1 }));

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations/${id}/resend`,
        undefined,
        headers(['user.invite']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        message: 'Invitation resent',
        data: { id, resentCount: 1 },
      });
    },
  );

  rowFor('Invitations')(
    '**`resend` refuses an unverified inviter before dialing the peer**',
    async () => {
      const id = '11111111-8888-4888-8888-111111111111';

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations/${id}/resend`,
        undefined,
        headers(['user.invite'], false),
      );

      expect(response.status).toBe(403);
      expect(
        peers.auth.calls('InvitationService/ResendInvitation'),
      ).toHaveLength(0);
    },
  );

  rowFor('Invitations')(
    '**`revoke` answers with the fixed message**',
    async () => {
      const id = '22222222-8888-4888-8888-222222222222';
      peers.auth.on('InvitationService/RevokeInvitation').reply({});

      const response = await new Session(gateway.baseUrl).request(
        'DELETE',
        `${API}/users/invitations/${id}`,
        {
          headers: headers(['user.invite']),
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ message: 'Invitation revoked' });
      const [call] = peers.auth.calls('InvitationService/RevokeInvitation');
      expect(call.request).toMatchObject({ invitationId: id, actorId: USER });
    },
  );

  rowFor('Invitations')(
    '**`previewByToken` needs no cookie at all**',
    async () => {
      peers.auth.on('InvitationService/PreviewInvitation').reply({
        valid: true,
        organizationName: 'Acme',
        inviterName: 'Ada Lovelace',
        email: 'i***@example.com',
        roleNames: ['Agent'],
        expiresAt: { seconds: 1_757_289_600, nanos: 0 },
      });

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/invitations/token/tok_abc123`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          valid: true,
          organizationName: 'Acme',
          email: 'i***@example.com',
        },
      });
    },
  );

  rowFor('Invitations')(
    '**`accept` redeems, signs the invitee in, and surfaces skipped assignments**',
    async () => {
      peers.auth.on('InvitationService/AcceptInvitation').reply({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
        user: {
          id: USER,
          organizationId: ORGANIZATION,
          fullName: 'Ada Lovelace',
          email: 'invitee@example.com',
          isEmailVerified: true,
          isPhoneVerified: false,
          isLocked: false,
          isTwoFactorEnabled: false,
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
          updatedAt: { seconds: 1_756_684_800, nanos: 0 },
        },
        skipped: ['role-1'],
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations/accept`,
        {
          token: 'tok_abc123',
          fullName: 'Ada Lovelace',
          password: 'Super-secret-1',
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        warning:
          '1 role/department assignment(s) no longer exist and were skipped',
        data: {
          user: { email: 'invitee@example.com' },
          requiresTwoFactor: false,
        },
      });
      expect(
        response.setCookie.some((line) =>
          line.startsWith(`${GATEWAY_ENV.JWT_ACCESS_NAME}=access-tok`),
        ),
      ).toBe(true);
    },
  );

  rowFor('Invitations')(
    '**`accept` takes the password rule sign-up does: 8+ with every character class, not length alone**',
    async () => {
      peers.auth.on('InvitationService/AcceptInvitation').reply({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
        user: {
          id: USER,
          organizationId: ORGANIZATION,
          fullName: 'Ada Lovelace',
          email: 'invitee@example.com',
          isEmailVerified: true,
          isPhoneVerified: false,
          isLocked: false,
          isTwoFactorEnabled: false,
          createdAt: { seconds: 1_756_684_800, nanos: 0 },
          updatedAt: { seconds: 1_756_684_800, nanos: 0 },
        },
        skipped: [],
      });
      const accept = (password: string) =>
        new Session(gateway.baseUrl).post(`${API}/users/invitations/accept`, {
          token: 'tok_abc123',
          fullName: 'Ada Lovelace',
          password,
        });

      // Thirteen characters, all lowercase letters.
      expect((await accept('longpasswordx')).status).toBe(400);
      expect(
        peers.auth.calls('InvitationService/AcceptInvitation'),
      ).toHaveLength(0);

      expect((await accept('Aa1!aaaa')).status).toBe(200);
    },
  );

  rowFor('Invitations')(
    '**`accept` refuses a caller who already holds a live session, before dialing the peer**',
    async () => {
      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations/accept`,
        {
          token: 'tok_abc123',
          fullName: 'Ada Lovelace',
          password: 'Super-secret-1',
        },
        headers(['user.read']),
      );

      expect(response.status).toBe(400);
      expect(
        peers.auth.calls('InvitationService/AcceptInvitation'),
      ).toHaveLength(0);
    },
  );

  rowFor('Invitations')(
    '**`previewBatch` is a dry run: no `EmailVerifiedGuard`, since nothing is sent**',
    async () => {
      peers.auth.on('InvitationService/PreviewInvitations').reply({
        rows: [
          {
            email: 'invitee@example.com',
            ok: true,
            unknownRoleIds: [],
            unknownDepartmentIds: [],
          },
        ],
        seatsInUse: 3,
        maxAgentSeats: 10,
        seatOverrun: 0,
      });

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations/preview`,
        {
          invitations: [
            { email: 'invitee@example.com', roleIds: [], departmentIds: [] },
          ],
        },
        headers(['user.invite'], false),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: { rows: [{ email: 'invitee@example.com', ok: true }] },
      });
    },
  );

  rowFor('Invitations')(
    '**`get` returns the admin detail by id, any status**',
    async () => {
      const id = '33333333-8888-4888-8888-333333333333';
      peers.auth
        .on('InvitationService/GetInvitation')
        .reply(wireInvitation(id, { status: 'INVITATION_STATUS_REVOKED' }));

      const response = await new Session(gateway.baseUrl).get(
        `${API}/users/invitations/${id}`,
        headers(['user.read']),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { id, status: 'REVOKED' } });
    },
  );

  rowFor('Invitations')(
    '**a caller with no organization (a super admin) reaches the peer with an EMPTY organization on every invitation route — the peer decides, the gateway never answers 500 first**',
    async () => {
      const superAdmin = {
        cookie: `${GATEWAY_ENV.JWT_ACCESS_NAME}=${sign(
          {
            sub: USER,
            organizationId: null,
            isSuperAdmin: true,
            departmentIds: [],
            permissionCodes: [],
            isEmailVerified: true,
          },
          TEST_KEYS.access(),
          { algorithm: 'RS256', expiresIn: '15m' },
        )}`,
      };
      const id = 'ffffffff-3333-4333-8333-ffffffffffff';
      const invitations = {
        invitations: [
          { email: 'a@example.com', roleIds: [], departmentIds: [] },
        ],
      };
      const requests: [string, string, unknown, string][] = [
        [
          'GET',
          `${API}/users/invitations/${id}`,
          undefined,
          'InvitationService/GetInvitation',
        ],
        [
          'DELETE',
          `${API}/users/invitations/${id}`,
          {},
          'InvitationService/RevokeInvitation',
        ],
        [
          'POST',
          `${API}/users/invitations/${id}/resend`,
          {},
          'InvitationService/ResendInvitation',
        ],
        [
          'POST',
          `${API}/users/invitations`,
          invitations,
          'InvitationService/CreateInvitations',
        ],
        [
          'POST',
          `${API}/users/invitations/preview`,
          invitations,
          'InvitationService/PreviewInvitations',
        ],
      ];

      for (const [method, path, body, rpc] of requests) {
        peers.auth.reset();
        const response = await new Session(gateway.baseUrl).request(
          method,
          path,
          {
            body,
            headers: superAdmin,
          },
        );
        const [call] = peers.auth.calls(rpc);

        // The peer was called, with no organization: a 500 here would mean the
        // gateway failed before asking.
        expect(call).toBeDefined();
        expect(call.request.organizationId ?? '').toBe('');
        expect(response.status).not.toBe(500);
      }
    },
  );

  /** A plan limit is 402 with auth-service's sentence; the marker stays behind. */
  rowFor('Invitations')(
    '**`create` with too few seats answers 402 with the server’s sentence**',
    async () => {
      const sentence =
        'No seats left. Revoke a pending invitation or change the plan to add people.';
      peers.auth
        .on('InvitationService/CreateInvitations')
        .fail(GrpcStatus.RESOURCE_EXHAUSTED, `[http:402] ${sentence}`);

      const response = await new Session(gateway.baseUrl).post(
        `${API}/users/invitations`,
        {
          invitations: [
            { email: 'invitee@example.com', roleIds: [], departmentIds: [] },
          ],
        },
        headers(['user.invite']),
      );

      expect(response.status).toBe(402);
      expect((response.body as { error: string }).error).toBe(
        `${sentence.slice(0, -1)}!`,
      );
    },
  );
});
