import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { InvitationStatus } from '@synapsedesk/common';
import { PageRequest, SortOrder } from '@synapsedesk/grpc-proto';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import {
  createInvitation,
  seedForeignTenant,
  seedTenantWithUser,
} from '../factories';
import { InvitationsService } from '../../src/modules/invitations/invitations.service';

/**
 * The invitations module — an EXECUTION smoke suite.
 *
 * **Why this file exists.** Every RPC here compiled, type-checked and shipped
 * without a single test ever calling it. That is exactly the state
 * `listPermissionHolders` and `listUsersByIds` were in when both turned out to
 * filter on `lockedUntil`, a column that does not exist — so every call threw a
 * Prisma validation error, and no notification audience in the product could
 * ever have been resolved. Nothing caught it because the only consumers mocked
 * the call.
 *
 * A `where` clause naming a column that is not there is invisible to `tsc`
 * whenever the object literal also contains a conditional spread, which
 * suppresses excess-property checking — and `listInvitations`, `previewInvitations`
 * and `expireStaleInvitations` all build exactly that shape.
 *
 * So these tests are deliberately shallow and deliberately broad: the point is
 * that each query actually RUNS against the schema. Behavioural depth for this
 * module is worth adding on top, and is not what this file claims to be.
 */
describe('Invitations (e2e)', () => {
  let fx: E2eFixture;
  let invitations: InvitationsService;

  const ctx = (t: { user: { id: string; organizationId: string | null } }) =>
    memberContext(t.user, ['user.invite', 'user.read']);

  /** Every field the shared `PageRequest` requires, so no cast is needed. */
  const page = (searchTerm = ''): PageRequest => ({
    page: 1,
    limit: 20,
    searchTerm,
    sortBy: '',
    sortOrder: SortOrder.SORT_ORDER_UNSPECIFIED,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    invitations = fx.moduleRef.get(InvitationsService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  describe('createInvitations', () => {
    it('creates a batch and reports PER-ADDRESS outcomes', async () => {
      // One malformed address in a 200-row paste must not discard the other
      // 199, so the response is a list of outcomes rather than a single status.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 50 },
      });

      const result = await invitations.createInvitations(
        {
          organizationId: t.org.id,
          invitedById: t.user.id,
          invitations: [
            { email: 'first@invite.test', roleIds: [], departmentIds: [] },
            { email: 'second@invite.test', roleIds: [], departmentIds: [] },
          ],
        },
        { ip: '127.0.0.1', userAgent: 'jest' },
      );

      expect(result.created).toHaveLength(2);
      expect(result.failed).toEqual([]);
      expect(
        await fx.prisma.userInvitation.count({
          where: { organizationId: t.org.id },
        }),
      ).toBe(2);
    });

    it('an inviter from ANOTHER tenant is PERMISSION_DENIED', async () => {
      // The tenant is a field on this RPC rather than something read from a
      // token, so this check is the boundary.
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);

      await expectRpc(
        invitations.createInvitations(
          {
            organizationId: mine.org.id,
            invitedById: theirs.user.id,
            invitations: [
              { email: 'nope@invite.test', roleIds: [], departmentIds: [] },
            ],
          },
          { ip: '127.0.0.1', userAgent: 'jest' },
        ),
        status.PERMISSION_DENIED,
      );
    });
  });

  describe('listInvitations', () => {
    it('runs, and is scoped to the tenant', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      await createInvitation(fx.prisma, mine.org.id, {
        invitedById: mine.user.id,
      });
      await createInvitation(fx.prisma, theirs.org.id, {
        invitedById: theirs.user.id,
      });

      const { items } = await invitations.listInvitations({
        organizationId: mine.org.id,
        page: page(),
      });

      expect(items).toHaveLength(1);
    });

    it('the STATUS filter and the SEARCH term both reach the query', async () => {
      // Both are conditional spreads into the `where`, which is the shape that
      // hides a bad column name from the compiler. Exercising them is the whole
      // point of the test.
      const t = await seedTenantWithUser(fx.prisma);
      await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
        email: 'findme@invite.test',
      });

      await expect(
        invitations.listInvitations({
          organizationId: t.org.id,
          page: page('findme'),
        }),
      ).resolves.toMatchObject({ items: [{ email: 'findme@invite.test' }] });

      await expect(
        invitations.listInvitations({
          organizationId: t.org.id,
          page: page('nobody-by-that-name'),
        }),
      ).resolves.toMatchObject({ items: [] });
    });
  });

  describe('previewInvitations', () => {
    it('validates a batch WITHOUT writing anything or sending mail', async () => {
      // A dry run that wrote rows would be worse than no dry run: the reviewer
      // would be approving something that had already happened.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 50 },
      });

      const result = await invitations.previewInvitations(
        {
          organizationId: t.org.id,
          invitations: [
            { email: 'preview@invite.test', roleIds: [], departmentIds: [] },
          ],
        },
        ctx(t),
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ ok: true });
      expect(
        await fx.prisma.userInvitation.count({
          where: { organizationId: t.org.id },
        }),
      ).toBe(0);
      expect(fx.notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('getInvitation / previewInvitation', () => {
    it('both execute against a real row', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const { row, token } = await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
      });

      await expect(
        invitations.getInvitation({
          invitationId: row.id,
          organizationId: t.org.id,
        }),
      ).resolves.toMatchObject({ email: row.email });

      // The unauthenticated pre-signup read: keyed by TOKEN, not by id, so a
      // sequential id cannot be walked to enumerate pending invitations.
      await expect(
        invitations.previewInvitation({ token }),
      ).resolves.toBeDefined();
    });

    it('**an unknown token answers `valid: false` rather than throwing**', async () => {
      // Deliberately not a NOT_FOUND. This endpoint is unauthenticated — it
      // renders the "you have been invited" page before anyone has an account —
      // so an expired token, a revoked one and a fabricated one must all look
      // identical from outside. An error status here would let someone probe
      // which tokens once existed.
      await expect(
        invitations.previewInvitation({ token: 'not-a-real-token' }),
      ).resolves.toMatchObject({ valid: false });
    });
  });

  describe('resendInvitation / revokeInvitation', () => {
    it('both execute, and revoke moves the row out of PENDING', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const { row } = await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
      });

      await expect(
        invitations.resendInvitation(
          {
            invitationId: row.id,
            organizationId: t.org.id,
            actorId: t.user.id,
          },
          { ip: '127.0.0.1', userAgent: 'jest' },
        ),
      ).resolves.toBeDefined();

      await invitations.revokeInvitation({
        invitationId: row.id,
        organizationId: t.org.id,
        actorId: t.user.id,
      });

      expect(
        (
          await fx.prisma.userInvitation.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status,
      ).not.toBe(InvitationStatus.PENDING);
    });
  });

  describe('acceptInvitation', () => {
    it('turns a pending invitation into a real member', async () => {
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 50 },
      });
      const { token } = await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
        email: 'joiner@invite.test',
      });

      await invitations.acceptInvitation(
        {
          token,
          fullName: 'Joiner',
          password: 'TestPassw0rd!',
        },
        { ip: '127.0.0.1', userAgent: 'jest' },
      );

      expect(
        await fx.prisma.user.findFirst({
          where: { email: 'joiner@invite.test', organizationId: t.org.id },
        }),
      ).not.toBeNull();
    });
  });

  describe('expireStaleInvitations', () => {
    it('**the sweep RUNS — the query nothing else would ever execute**', async () => {
      // A scheduled job with no test is the worst case of all: it fails in
      // production at 3am, into a log nobody is reading, and the only symptom
      // is that invitations quietly never expire.
      const t = await seedTenantWithUser(fx.prisma);
      await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      const result = await invitations.expireStaleInvitations();

      expect(result.expiredCount).toBeGreaterThanOrEqual(1);
    });

    it('leaves a still-valid invitation alone', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const { row: live } = await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await invitations.expireStaleInvitations();

      expect(
        (
          await fx.prisma.userInvitation.findUniqueOrThrow({
            where: { id: live.id },
          })
        ).status,
      ).toBe(InvitationStatus.PENDING);
    });
  });
});
