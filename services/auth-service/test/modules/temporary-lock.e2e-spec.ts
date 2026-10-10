import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { SCHEDULED_JOBS, SystemRoleName } from '@synapsedesk/common';
import { toProtoTimestamp, UserProjection } from '@synapsedesk/grpc-proto';
import {
  E2eFixture,
  bootstrapE2eTest,
  requestOrigin,
  superuser,
} from '../utils';
import {
  addMember,
  createTrustedDeviceSession,
  seedTenantWithUser,
  SeededTenant,
  TEST_PASSWORD,
} from '../factories';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UsersService } from '../../src/modules/users/users.service';
import { ExpiredLockSweep } from '../../src/modules/users/expired-lock.sweep';
import { SchedulerProcessor } from '../../src/modules/scheduler/scheduler.processor';
import { DatabaseSeeder } from '../../src/modules/prisma/database.seeder';

/**
 * **Temporary locks**.
 *
 * The design under test is the one that kept this feature to three call sites
 * instead of 22: `is_locked` stays the single authoritative boolean that every
 * read asks about, and `locked_until` is only an EXPIRY. Two mechanisms turn
 * that expiry into an unlock — a lazy one on the login path and an hourly
 * sweep — and the redundancy is deliberate, because each closes a gap the other
 * cannot.
 *
 * The naive alternative, `isLocked || lockedUntil > now` at every read site, is
 * 22 chances to get a boolean wrong in code where wrong means either a locked
 * user logs in or an unlocked one cannot.
 */
describe('Temporary locks (e2e)', () => {
  let fx: E2eFixture;
  let auth: AuthService;
  let users: UsersService;
  let sweep: ExpiredLockSweep;
  let scheduler: SchedulerProcessor;

  let tenant: SeededTenant;

  const HOUR = 60 * 60 * 1000;
  const inHours = (hours: number) => new Date(Date.now() + hours * HOUR);
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

  const lockedRow = (id: string) =>
    fx.prisma.user.findUniqueOrThrow({ where: { id } });

  /** A member who can actually log in, plus a lock applied to them. */
  const lockedMember = async (lockedUntil?: Date) => {
    const member = await addMember(fx.prisma, tenant.org.id, {
      user: { email: 'locked@member.test' },
    });

    await users.lockUser(
      {
        id: member.id,
        reason: 'Suspected compromise',
        lockedUntil: lockedUntil ? toProtoTimestamp(lockedUntil) : undefined,
      },
      superuser(tenant),
    );

    return member;
  };

  const login = (email: string) =>
    auth.login({ email, password: TEST_PASSWORD }, requestOrigin());

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    auth = fx.moduleRef.get(AuthService);
    users = fx.moduleRef.get(UsersService);
    sweep = fx.moduleRef.get(ExpiredLockSweep);
    scheduler = fx.moduleRef.get(SchedulerProcessor);
  });

  beforeEach(async () => {
    await fx.reset();
    // The seeded role holds this permission so test 8 can assert on the
    // permission-holder audience — the default is an empty permission set.
    tenant = await seedTenantWithUser(fx.prisma, {
      permissionCodes: ['ticket.read.all'],
    });
  });

  afterAll(() => fx.close());

  describe('the existing product, unchanged', () => {
    it('1. **an INDEFINITE lock behaves exactly as it always did**', async () => {
      // The regression test for the whole change. Every other test here proves
      // the new feature; this one proves the feature that already existed still
      // works — which is the thing a 22-call-site refactor would have broken.
      const member = await lockedMember();

      const row = await lockedRow(member.id);
      expect(row.isLocked).toBe(true);
      expect(row.lockedUntil).toBeNull();

      await expectRpc(login(member.email), status.UNAUTHENTICATED);
    });

    it('2. an indefinite lock still revokes every session', async () => {
      const member = await addMember(fx.prisma, tenant.org.id);
      await createTrustedDeviceSession(fx.prisma, member.id);

      const { revokedSessionCount } = await users.lockUser(
        { id: member.id, reason: 'x' },
        superuser(tenant),
      );

      expect(revokedSessionCount).toBe(1);
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: member.id } }),
      ).toBe(0);
    });

    it('3. the sweep NEVER touches an indefinite lock', async () => {
      // Including the seeded SYSTEM user, which is `isLocked: true` with no
      // expiry precisely so it can never be used as a login. A sweep that read
      // "locked" as "sweepable" would hand it an account with no password and
      // `isSuperAdmin: true`.
      const member = await lockedMember();

      await expect(sweep.sweep()).resolves.toBe(0);
      expect((await lockedRow(member.id)).isLocked).toBe(true);

      const system = await fx.prisma.user.findFirstOrThrow({
        where: { isSuperAdmin: true, isLocked: true, passwordHash: null },
      });
      expect(system.isLocked).toBe(true);
    });
  });

  describe('lazy unlock — the login path', () => {
    it('4. login AFTER the expiry succeeds and clears both columns', async () => {
      const member = await lockedMember(inHours(1));

      // The clock cannot be moved forward here — bcrypt and Prisma both run on
      // real time — so the expiry is moved backwards instead, which produces
      // exactly the state "now is past lockedUntil".
      await fx.prisma.user.update({
        where: { id: member.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      await expect(login(member.email)).resolves.toBeDefined();

      const row = await lockedRow(member.id);
      expect(row.isLocked).toBe(false);
      expect(row.lockedUntil).toBeNull();
    });

    it('5. login BEFORE the expiry still fails, and leaves the lock intact', async () => {
      const member = await lockedMember(inHours(1));

      await expectRpc(login(member.email), status.UNAUTHENTICATED);

      const row = await lockedRow(member.id);
      expect(row.isLocked).toBe(true);
      expect(row.lockedUntil).not.toBeNull();
    });

    it('6. **an expired lock does NOT revive revoked sessions**', async () => {
      // Unlocking permits signing in; it does not sign in. Already true of
      // `unlockUser`, asserted here because the new path is a second way to
      // reach the same state and could have been written to "restore".
      const member = await addMember(fx.prisma, tenant.org.id, {
        user: { email: 'sessions@lock.test' },
      });
      await createTrustedDeviceSession(fx.prisma, member.id);

      await users.lockUser(
        {
          id: member.id,
          reason: 'x',
          lockedUntil: toProtoTimestamp(inHours(1)),
        },
        superuser(tenant),
      );
      await fx.prisma.user.update({
        where: { id: member.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      await login(member.email);

      // Exactly the one session the login just created — not the revoked one.
      const sessions = await fx.prisma.deviceSession.findMany({
        where: { userId: member.id },
      });
      expect(sessions).toHaveLength(1);
    });
  });

  describe('the sweep — everything that is not a login', () => {
    it('7. clears expired locks and leaves unexpired ones', async () => {
      const expired = await lockedMember(inHours(1));
      await fx.prisma.user.update({
        where: { id: expired.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      const stillLocked = await addMember(fx.prisma, tenant.org.id, {
        user: { email: 'still@locked.test' },
      });
      await users.lockUser(
        {
          id: stillLocked.id,
          reason: 'x',
          lockedUntil: toProtoTimestamp(inHours(5)),
        },
        superuser(tenant),
      );

      await expect(sweep.sweep()).resolves.toBe(1);

      expect((await lockedRow(expired.id)).isLocked).toBe(false);
      expect((await lockedRow(stillLocked.id)).isLocked).toBe(true);
    });

    it('8. **a swept user reappears in both notification audiences**', async () => {
      // The gap the lazy unlock cannot close, and the reason both mechanisms
      // exist. A user whose lock expired but who never attempts a login stays
      // excluded from every audience until something else notices — and for a
      // locked account, "never attempts a login" is the normal case.
      const member = await addMember(fx.prisma, tenant.org.id, {
        roleIds: [tenant.role.id],
        user: { email: 'audience@lock.test' },
      });

      await users.lockUser(
        {
          id: member.id,
          reason: 'x',
          lockedUntil: toProtoTimestamp(inHours(1)),
        },
        superuser(tenant),
      );
      await fx.prisma.user.update({
        where: { id: member.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      // Still invisible — `isLocked` is authoritative and nothing has cleared it.
      const before = await users.listUsersByIds({
        organizationId: tenant.org.id,
        userIds: [member.id],
        // The NOTIFICATION caller, unchanged. `false` here
        // is what keeps "a notification to a deactivated account is a row
        // nobody reads" true after the flag was added for the loader.
        includeInactive: false,
        projection: UserProjection.USER_PROJECTION_NOTIFICATION,
      });
      expect(before.items).toEqual([]);

      await sweep.sweep();

      const after = await users.listUsersByIds({
        organizationId: tenant.org.id,
        userIds: [member.id],
        includeInactive: false,
        projection: UserProjection.USER_PROJECTION_NOTIFICATION,
      });
      expect(after.items.map((item) => item.userId)).toEqual([member.id]);

      // And the permission-holder audience, which is the other one.
      const holders = await users.listPermissionHolders({
        organizationId: tenant.org.id,
        permissionCode: 'ticket.read.all',
      });
      expect(holders.items.map((item) => item.userId)).toContain(member.id);
    });

    it('9. **the sweep and the lazy unlock race to ONE unlock**', async () => {
      // At expiry both mechanisms firing at once is the NORMAL case, not an
      // edge case — the hourly tick and the user's next login attempt are
      // independent. Both writes are conditional on the row still being locked,
      // so the loser updates zero rows and records nothing.
      const member = await lockedMember(inHours(1));
      await fx.prisma.user.update({
        where: { id: member.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      fx.audit.record.mockClear();

      const [, swept] = await Promise.all([login(member.email), sweep.sweep()]);

      const unlockEvents =
        fx.audit.record.mock.calls.filter(
          ([, event]: [unknown, { action: string }]) =>
            event.action === 'USER_UNLOCKED',
        ).length + swept;

      expect(unlockEvents).toBe(1);
      expect((await lockedRow(member.id)).isLocked).toBe(false);
    });

    it('**9b. the sweep NAMES itself in the audit row**', async () => {
      // The defect this replaced: `recordSystem`'s origin was optional with a
      // default, this call site passed nothing, and every unlock row silently
      // said `scheduler` instead of naming the service. Nothing failed, because
      // nothing looked.
      const member = await lockedMember(inHours(1));
      await fx.prisma.user.update({
        where: { id: member.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      // Cleared first: locking the member already sent its own notification
      // and audit row, so call [0] is not the sweep's.
      fx.audit.recordSystem.mockClear();
      await sweep.sweep();

      const [[event]] = fx.audit.recordSystem.mock.calls as [
        [{ action: string; origin: string }],
      ];
      expect(event.action).toBe('USER_UNLOCKED');
      expect(event.origin).toBe('auth-service/scheduler');
    });

    it('**9c. the audit row and the notification agree on WHO unlocked it**', async () => {
      // Two records of one event, written nine lines apart. They disagreed for
      // a step, and the only thing that would have caught it is comparing them.
      const member = await lockedMember(inHours(1));
      await fx.prisma.user.update({
        where: { id: member.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      fx.audit.recordSystem.mockClear();
      fx.notifications.sendEmail.mockClear();
      await sweep.sweep();

      const [[audited]] = fx.audit.recordSystem.mock.calls as [
        [{ origin: string }],
      ];
      const [[emailed]] = fx.notifications.sendEmail.mock.calls as [
        [{ data: { origin: { userAgent: string } } }],
      ];
      expect(emailed.data.origin.userAgent).toBe(audited.origin);
    });

    it('10. runs on the HOURLY scheduled job, not on its own timer', async () => {
      // 's rule: a job is not done until something calls it. The sweep
      // being correct is worth nothing if nothing invokes it.
      const member = await lockedMember(inHours(1));
      await fx.prisma.user.update({
        where: { id: member.id },
        data: { lockedUntil: hoursAgo(1) },
      });

      await scheduler.process({
        name: SCHEDULED_JOBS.AUTH_HOURLY,
        data: {},
      } as never);

      expect((await lockedRow(member.id)).isLocked).toBe(false);
    });
  });

  describe('the rules that stop a lock becoming nonsense', () => {
    it('11. **a PAST lockedUntil is rejected**', async () => {
      // It would lock and unlock in the same instant: legal in the database,
      // incomprehensible to the admin who set it and the user who was emailed.
      const member = await addMember(fx.prisma, tenant.org.id);

      await expectRpc(
        users.lockUser(
          {
            id: member.id,
            reason: 'x',
            lockedUntil: toProtoTimestamp(hoursAgo(1)),
          },
          superuser(tenant),
        ),
        status.INVALID_ARGUMENT,
      );

      expect((await lockedRow(member.id)).isLocked).toBe(false);
    });

    it('12. **manual unlock clears `lockedUntil` too**', async () => {
      // Otherwise a later INDEFINITE re-lock silently inherits an expiry
      // nobody asked for, and the account quietly unlocks itself.
      const member = await lockedMember(inHours(5));

      await users.unlockUser({ id: member.id }, superuser(tenant));

      const row = await lockedRow(member.id);
      expect(row.isLocked).toBe(false);
      expect(row.lockedUntil).toBeNull();
    });

    it('13. re-locking indefinitely does not inherit a previous expiry', async () => {
      const member = await lockedMember(inHours(5));
      await users.unlockUser({ id: member.id }, superuser(tenant));

      await users.lockUser(
        { id: member.id, reason: 'again, permanently' },
        superuser(tenant),
      );

      const row = await lockedRow(member.id);
      expect(row.isLocked).toBe(true);
      expect(row.lockedUntil).toBeNull();
    });

    it('14. the lock email SAYS when it ends, in the recipient’s timezone', async () => {
      // For a temporary lock this is the difference between a support ticket
      // and no support ticket — the user has no other way to find out.
      const member = await addMember(fx.prisma, tenant.org.id, {
        user: { email: 'tz@lock.test', timezone: 'Asia/Ho_Chi_Minh' },
      });

      fx.notifications.sendEmail.mockClear();

      await users.lockUser(
        {
          id: member.id,
          reason: 'x',
          lockedUntil: toProtoTimestamp(inHours(30)),
        },
        superuser(tenant),
      );

      const [command] = fx.notifications.sendEmail.mock.calls[0] as [
        { data: { detail: string } },
      ];
      expect(command.data.detail).toContain('unlock automatically');
      // The zone is named, always — an unlabelled time is what generates the
      // ticket this sentence exists to prevent.
      expect(command.data.detail).toMatch(/GMT|UTC/);
    });

    it('15. an INDEFINITE lock’s email promises no unlock time', async () => {
      const member = await addMember(fx.prisma, tenant.org.id);

      fx.notifications.sendEmail.mockClear();
      await users.lockUser({ id: member.id, reason: 'x' }, superuser(tenant));

      const [command] = fx.notifications.sendEmail.mock.calls[0] as [
        { data: { detail: string } },
      ];
      expect(command.data.detail).not.toContain('unlock automatically');
    });
  });

  describe('the invariant a temporary lock must not break', () => {
    it('16. **a temp-locked Org Admin still counts as inactive**', async () => {
      // The rule that stops a tenant becoming unadministrable. `assertRemovable`
      // reads `isLocked`, which a temporary lock sets like any other — so the
      // last unlocked admin cannot be removed even while a colleague's lock is
      // merely temporary.
      const first = await addMember(fx.prisma, tenant.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
        user: { email: 'admin-one@lock.test' },
      });
      const second = await addMember(fx.prisma, tenant.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
        user: { email: 'admin-two@lock.test' },
      });

      await users.lockUser(
        {
          id: first.id,
          reason: 'x',
          lockedUntil: toProtoTimestamp(inHours(1)),
        },
        superuser(tenant),
      );

      // `second` is now the only ACTIVE Org Admin, so locking them must fail.
      await expectRpc(
        users.lockUser({ id: second.id, reason: 'x' }, superuser(tenant)),
        status.ABORTED,
      );
    });
  });

  /**
   * B — the state matrix.
   *
   * Two columns is four states on paper and only three mean anything. The two
   * invalid ones are **unrepresentable rather than merely unwritten**: both
   * mechanisms already clear the pair together, so the CHECK constraint exists
   * for the write that FORGETS to — and every one of those would otherwise
   * produce a row that looks perfectly fine.
   */
  describe('B the state matrix', () => {
    /** Writes the pair directly, bypassing every service that maintains it. */
    const writePair = (
      id: string,
      isLocked: boolean,
      lockedUntil: Date | null,
    ) =>
      fx.prisma.$executeRawUnsafe(
        'UPDATE users SET is_locked = $1, locked_until = $2 WHERE id = $3',
        isLocked,
        lockedUntil,
        id,
      );

    it('17. the three VALID states are all writable', async () => {
      const member = await addMember(fx.prisma, tenant.org.id, {
        user: { email: 'matrix@lock.test' },
      });

      // Indefinite lock — the existing behaviour.
      await expect(writePair(member.id, true, null)).resolves.toBeDefined();
      // Temporary lock.
      await expect(
        writePair(member.id, true, inHours(5)),
      ).resolves.toBeDefined();
      // Not locked. Note the ORDER: clearing the boolean while an expiry is
      // still set is exactly what the constraint forbids, so a caller must
      // clear both together — which is what both mechanisms do.
      await expect(writePair(member.id, false, null)).resolves.toBeDefined();
    });

    it('18. **`false` + a FUTURE expiry is rejected by the database**', async () => {
      // Meaningless as written — "not locked, but scheduled to stop being
      // locked". And specifically NOT a scheduled future lock: that is a
      // different feature needing its own column and its own sweep, and
      // leaving this state invalid is what stops somebody half-implementing it
      // by setting a field.
      const member = await addMember(fx.prisma, tenant.org.id, {
        user: { email: 'future@lock.test' },
      });

      await expect(writePair(member.id, false, inHours(5))).rejects.toThrow(
        /users_locked_until_requires_lock/,
      );
    });

    it('19. **`false` + a PAST expiry is rejected too** — no stale residue', async () => {
      // Behaviourally unlocked, but leaving the expiry behind makes a row
      // nobody reading it should have to interpret — and it is what a later
      // indefinite re-lock would silently inherit.
      const member = await addMember(fx.prisma, tenant.org.id, {
        user: { email: 'stale@lock.test' },
      });

      await expect(writePair(member.id, false, hoursAgo(5))).rejects.toThrow(
        /users_locked_until_requires_lock/,
      );
    });

    it('20. **`true` + a PAST expiry IS allowed** — it is a window, not a state', async () => {
      // The converging window between an expiry passing and a mechanism
      // noticing. Forbidding it would make the expiry itself unrepresentable,
      // since every temporary lock passes through this the moment it lapses.
      const member = await addMember(fx.prisma, tenant.org.id, {
        user: { email: 'window@lock.test' },
      });

      await expect(
        writePair(member.id, true, hoursAgo(1)),
      ).resolves.toBeDefined();
    });

    it('21. the constraint survives a re-seed', async () => {
      // Applied from the SEED rather than a one-off command, because
      // `db push --force-reset` neither creates nor preserves a hand-written
      // constraint — a reset would silently drop it and leave a schema that
      // looks correct.
      const seeder = fx.moduleRef.get(DatabaseSeeder);
      await seeder.seed();

      const [{ count }] = await fx.prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*)::bigint AS count FROM pg_constraint
           WHERE conname = 'users_locked_until_requires_lock'`,
      );
      expect(Number(count)).toBe(1);
    });

    it('22. **during the window, login unlocks but every other read does not**', async () => {
      // The asymmetry is deliberate and bounded by the sweep interval: the
      // surface where being wrong is visible and urgent (a user who cannot sign
      // in) converges instantly, and the surfaces where being wrong is
      // invisible and cheap (one missed notification) converge within the hour.
      // Reading the pair everywhere would close the window at the cost of the
      // 22-site edit this design exists to avoid.
      const member = await addMember(fx.prisma, tenant.org.id, {
        roleIds: [tenant.role.id],
        user: { email: 'window-reads@lock.test' },
      });
      await users.lockUser(
        {
          id: member.id,
          reason: 'x',
          lockedUntil: toProtoTimestamp(inHours(1)),
        },
        superuser(tenant),
      );
      await writePair(member.id, true, hoursAgo(1));

      // Every non-login read still says locked, by design.
      const audience = await users.listPermissionHolders({
        organizationId: tenant.org.id,
        permissionCode: 'ticket.read.all',
      });
      expect(audience.items.map((item) => item.userId)).not.toContain(
        member.id,
      );

      // And login converges it immediately.
      await expect(login(member.email)).resolves.toBeDefined();
      expect((await lockedRow(member.id)).isLocked).toBe(false);
    });
  });
});
