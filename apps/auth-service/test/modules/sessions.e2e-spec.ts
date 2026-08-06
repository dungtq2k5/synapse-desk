import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { EmailTemplateName } from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture, memberContext } from '../utils';
import {
  addMember,
  createDeviceSession,
  createTrustedDeviceSession,
  seedForeignTenant,
  seedTenantWithUser,
} from '../factories';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { AuthService } from '../../src/modules/auth/auth.service';

describe('Sessions (e2e)', () => {
  let fx: E2eFixture;
  let sessions: SessionsService;
  let auth: AuthService;

  /** The caller acting on their OWN sessions. */
  const own = (t: { user: { id: string; organizationId: string | null } }) =>
    memberContext(t.user);

  /** An administrator acting on someone else's. */
  const admin = (t: { user: { id: string; organizationId: string | null } }) =>
    memberContext(t.user, ['user.session.read', 'user.session.revoke']);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    sessions = fx.moduleRef.get(SessionsService);
    auth = fx.moduleRef.get(AuthService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  // ------------------------------------------------------------------ listing

  describe('listSessions', () => {
    it('1. the list excludes rows with rotated_at set', async () => {
      // The single highest-risk bug in this module. Every refresh RETAINS the
      // spent row — that retention is what makes replay detectable — so a naive
      // list shows one "device" per refresh, and a user who has been signed in a
      // week sees dozens of phantom sessions they cannot explain.
      const t = await seedTenantWithUser(fx.prisma);
      const { refreshToken } = await createDeviceSession(fx.prisma, t.user.id);

      // Five refreshes on one device.
      let current = refreshToken;
      for (let i = 0; i < 5; i++) {
        current = (
          await auth.refreshToken(
            { refreshToken: current },
            memberContext(t.user),
          )
        ).refreshToken;
      }

      // Six rows exist; one session.
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: t.user.id } }),
      ).toBe(6);

      const list = await sessions.listSessions(
        { refreshToken: current },
        own(t),
      );
      expect(list.items).toHaveLength(1);
    });

    it('2. the list excludes expired rows', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      await createDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, t.user.id, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const list = await sessions.listSessions({ refreshToken: '' }, own(t));

      expect(list.items).toHaveLength(1);
    });

    it('3. `current` is decided by family id, not by IP or user-agent', async () => {
      // Two browsers on one machine share an IP and may share a user-agent
      // string; the family is the only thing that actually distinguishes "this
      // session" from "that one".
      const t = await seedTenantWithUser(fx.prisma);

      const sharedOrigin = {
        ipAddress: '203.0.113.7',
        userAgent: 'Chrome/1.0',
      };
      const mine = await createDeviceSession(
        fx.prisma,
        t.user.id,
        sharedOrigin,
      );
      const theirs = await createDeviceSession(
        fx.prisma,
        t.user.id,
        sharedOrigin,
      );

      const list = await sessions.listSessions(
        { refreshToken: mine.refreshToken },
        own(t),
      );

      const current = list.items.filter((s) => s.current);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(mine.session.id);
      expect(list.items.find((s) => s.id === theirs.session.id)!.current).toBe(
        false,
      );
    });

    it('3b. `current` survives a rotation — the family is constant', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const { session, refreshToken } = await createDeviceSession(
        fx.prisma,
        t.user.id,
      );

      const rotated = await auth.refreshToken(
        { refreshToken },
        memberContext(t.user),
      );

      const list = await sessions.listSessions(
        { refreshToken: rotated.refreshToken },
        own(t),
      );

      expect(list.items).toHaveLength(1);
      expect(list.items[0].current).toBe(true);
      // A new row, same family.
      expect(list.items[0].id).not.toBe(session.id);
    });

    it('an unknown refresh token simply means "nothing is current"', async () => {
      // Not an error: listing sessions is a read, and a caller whose cookie has
      // expired should still be able to see their devices.
      const t = await seedTenantWithUser(fx.prisma);
      await createDeviceSession(fx.prisma, t.user.id);

      const list = await sessions.listSessions(
        { refreshToken: 'not-a-real-token' },
        own(t),
      );

      expect(list.items).toHaveLength(1);
      expect(list.items[0].current).toBe(false);
    });

    it('the list never carries a token hash', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      await createTrustedDeviceSession(fx.prisma, t.user.id);

      const list = await sessions.listSessions({ refreshToken: '' }, own(t));

      expect(JSON.stringify(list)).not.toMatch(
        /refreshTokenHash|deviceTokenHash/,
      );
    });

    // ----------------------------------------------------------------- revoking
  });

  describe('revokeSession', () => {
    it('4. revoking a session ends the whole FAMILY, mid-rotation row included', async () => {
      // Revoking one row would let a rotation already in flight outlive the
      // revocation: the successor was minted from the same family and would
      // still resolve.
      const t = await seedTenantWithUser(fx.prisma);
      const { session, refreshToken } = await createDeviceSession(
        fx.prisma,
        t.user.id,
      );
      const rotated = await auth.refreshToken(
        { refreshToken },
        memberContext(t.user),
      );

      // Two rows in this family now: the spent one and its successor.
      expect(
        await fx.prisma.deviceSession.count({
          where: { familyId: session.familyId },
        }),
      ).toBe(2);

      const result = await sessions.revokeSession(
        { sessionId: session.id, refreshToken: rotated.refreshToken },
        own(t),
      );

      expect(result.revokedCount).toBe(2);
      expect(
        await fx.prisma.deviceSession.count({
          where: { familyId: session.familyId },
        }),
      ).toBe(0);
    });

    it('4b. `wasCurrent` is resolved BEFORE the delete', async () => {
      // Afterwards the caller's own token matches no row, so the answer would
      // always be "not current" and the UI could never say "you signed yourself
      // out".
      const t = await seedTenantWithUser(fx.prisma);
      const { session, refreshToken } = await createDeviceSession(
        fx.prisma,
        t.user.id,
      );

      const result = await sessions.revokeSession(
        { sessionId: session.id, refreshToken },
        own(t),
      );

      expect(result.wasCurrent).toBe(true);
    });

    it('4c. revoking another device reports wasCurrent false and leaves this one alive', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const mine = await createDeviceSession(fx.prisma, t.user.id);
      const other = await createDeviceSession(fx.prisma, t.user.id);

      const result = await sessions.revokeSession(
        { sessionId: other.session.id, refreshToken: mine.refreshToken },
        own(t),
      );

      expect(result.wasCurrent).toBe(false);
      expect(
        await fx.prisma.deviceSession.findUnique({
          where: { id: mine.session.id },
        }),
      ).not.toBeNull();
    });

    it("another user's session id is 404, not 403", async () => {
      // A 403 confirms the id exists, which is all an attacker enumerating
      // session ids actually wants.
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedTenantWithUser(fx.prisma);
      const foreign = await createDeviceSession(fx.prisma, theirs.user.id);

      await expectRpc(
        sessions.revokeSession(
          { sessionId: foreign.session.id, refreshToken: '' },
          own(mine),
        ),
        status.NOT_FOUND,
      );

      expect(
        await fx.prisma.deviceSession.findUnique({
          where: { id: foreign.session.id },
        }),
      ).not.toBeNull();
    });

    // -------------------------------------------------------------------- trust
  });

  describe('revokeSessionTrust', () => {
    it('5. dropping trust clears the token but leaves the session live', async () => {
      // The user stays signed in on that device; the next login from it gets a
      // 2FA prompt again. Distinct from revoking, which signs them out.
      const t = await seedTenantWithUser(fx.prisma);
      const { session } = await createTrustedDeviceSession(
        fx.prisma,
        t.user.id,
      );

      const result = await sessions.revokeSessionTrust(
        { sessionId: session.id, refreshToken: '' },
        own(t),
      );

      expect(result.untrustedCount).toBe(1);

      const row = await fx.prisma.deviceSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      // All three clear together: `isTrusted` alone would leave a live
      // `deviceTokenHash` that the trusted-device lookup still matches.
      expect(row.isTrusted).toBe(false);
      expect(row.deviceTokenHash).toBeNull();
      expect(row.trustedUntil).toBeNull();
      // Still signed in.
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('5b. the un-trusted device is challenged again at the next login', async () => {
      // The behavioural proof — clearing three columns only matters if the login
      // path reads them.
      const t = await seedTenantWithUser(fx.prisma);
      const { session, deviceToken } = await createTrustedDeviceSession(
        fx.prisma,
        t.user.id,
      );
      await fx.prisma.user.update({
        where: { id: t.user.id },
        data: { isTwoFactorEnabled: true, twoFactorSecret: 'stub-secret' },
      });

      await sessions.revokeSessionTrust(
        { sessionId: session.id, refreshToken: '' },
        own(t),
      );

      const login = await auth.login(
        { email: t.user.email, password: t.password, deviceToken },
        { ip: '203.0.113.9', userAgent: 'jest' },
      );
      expect(login.requiresTwoFactor).toBe(true);
    });
  });

  describe('revokeAllTrust', () => {
    it('6. revoking ALL trust un-trusts every device and keeps every session', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      await createTrustedDeviceSession(fx.prisma, t.user.id);
      await createTrustedDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, t.user.id);

      const result = await sessions.revokeAllTrust(own(t));

      expect(result.untrustedCount).toBe(3);
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: t.user.id } }),
      ).toBe(3);
      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: t.user.id, deviceTokenHash: { not: null } },
        }),
      ).toBe(0);
    });

    it('6b. it reaches SPENT and EXPIRED rows too', async () => {
      // Trust outlives the session it was granted on by design — 30 days against
      // 7 — so a filter on live sessions would leave behind exactly the trust
      // this endpoint exists to remove.
      const t = await seedTenantWithUser(fx.prisma);
      await createTrustedDeviceSession(fx.prisma, t.user.id, {
        rotatedAt: new Date(),
      });
      await createTrustedDeviceSession(fx.prisma, t.user.id, {
        expiresAt: new Date(Date.now() - 1000),
      });

      await sessions.revokeAllTrust(own(t));

      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: t.user.id, deviceTokenHash: { not: null } },
        }),
      ).toBe(0);
    });

    it("revoking all trust does not touch another user's devices", async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedTenantWithUser(fx.prisma);
      await createTrustedDeviceSession(fx.prisma, theirs.user.id);

      await sessions.revokeAllTrust(own(mine));

      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: theirs.user.id, deviceTokenHash: { not: null } },
        }),
      ).toBe(1);
    });

    // ----------------------------------------------------------- administrative
  });

  describe('listUserSessions', () => {
    it('7. listing a user in ANOTHER tenant is 404, not their sessions', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      await createDeviceSession(fx.prisma, theirs.user.id);

      await expectRpc(
        sessions.listUserSessions({ userId: theirs.user.id }, admin(mine)),
        status.NOT_FOUND,
      );
    });

    it('7b. an admin listing a colleague sees their live sessions, none marked current', async () => {
      // `current` is meaningless on an admin view: the admin's own refresh token
      // identifies none of the target's families, and marking one would be a lie.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      await createDeviceSession(fx.prisma, target.id);
      await createDeviceSession(fx.prisma, target.id);

      const list = await sessions.listUserSessions(
        { userId: target.id },
        admin(t),
      );

      expect(list.items).toHaveLength(2);
      expect(list.items.every((s) => s.current === false)).toBe(true);
    });
  });

  describe('revokeUserSessions', () => {
    it('8. force-logout clears sessions AND trust', async () => {
      // Incident-response semantics. Leaving `device_token_hash` alive would let
      // the device this exists to cut off skip 2FA on its very next login.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      await createTrustedDeviceSession(fx.prisma, target.id);
      await createTrustedDeviceSession(fx.prisma, target.id);

      const result = await sessions.revokeUserSessions(
        { userId: target.id },
        admin(t),
      );

      expect(result.revokedCount).toBe(2);
      // Row deletion, not an update — the trust columns live on these rows.
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: target.id } }),
      ).toBe(0);
    });

    it('8b. force-logout on a foreign user is 404 and changes nothing', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      await createDeviceSession(fx.prisma, theirs.user.id);

      await expectRpc(
        sessions.revokeUserSessions({ userId: theirs.user.id }, admin(mine)),
        status.NOT_FOUND,
      );

      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: theirs.user.id },
        }),
      ).toBe(1);
    });

    it('9. force-logout tells the target and records an audit row', async () => {
      // They should learn this from us rather than from being silently signed
      // out mid-task.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      await createDeviceSession(fx.prisma, target.id);

      await sessions.revokeUserSessions({ userId: target.id }, admin(t));

      expect(fx.notifications.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          template: EmailTemplateName.SECURITY_ALERT,
          to: target.email,
        }),
      );

      expect(fx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ sub: t.user.id }),
        expect.objectContaining({ resourceId: target.id }),
      );
    });

    // ---------------------------------------------------------------- internals
  });

  describe('revokeAllForUser / revokeAllExceptFamily', () => {
    it('revokeAllForUser is the one definition the other three callers share', async () => {
      // `logout/all`, user lock and user delete all need exactly this. Three
      // copies would eventually disagree about whether trust goes with it.
      const t = await seedTenantWithUser(fx.prisma);
      await createTrustedDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, t.user.id);

      const count = await sessions.revokeAllForUser(t.user.id);

      expect(count).toBe(2);
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: t.user.id } }),
      ).toBe(0);
    });

    it('revokeAllExceptFamily spares exactly the presented family', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const keep = await createDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, t.user.id);

      const count = await sessions.revokeAllExceptFamily(
        t.user.id,
        keep.refreshToken,
      );

      expect(count).toBe(2);
      expect(
        await fx.prisma.deviceSession.findUnique({
          where: { id: keep.session.id },
        }),
      ).not.toBeNull();
    });

    it('revokeAllExceptFamily with no token revokes everything', async () => {
      // The caller had no refresh cookie to spare — sparing "nothing" is the
      // only safe reading, and sparing "everything" would silently turn a
      // password change into a no-op.
      const t = await seedTenantWithUser(fx.prisma);
      await createDeviceSession(fx.prisma, t.user.id);
      await createDeviceSession(fx.prisma, t.user.id);

      const count = await sessions.revokeAllExceptFamily(t.user.id, undefined);

      expect(count).toBe(2);
    });
  });
});
