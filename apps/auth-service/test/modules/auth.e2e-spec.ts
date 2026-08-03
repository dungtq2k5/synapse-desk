import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  EmailTemplateName,
  OrgStatus,
  SystemRoleName,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { memberContext, requestOrigin } from '../utils/context';
import {
  addMember,
  createDeviceSession,
  createOrganization,
  createPasswordResetToken,
  createTrustedDeviceSession,
  createUserWithPassword,
  hashTestPassword,
  seedTenantWithUser,
  TEST_PASSWORD,
} from '../factories';
import { AuthService } from '../../src/modules/auth/auth.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { hashToken } from '../../src/common/utils/utils';

/** Extracts the gRPC status code from a thrown RpcException. */
function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

/**
 * Asserts a call rejects with a specific gRPC status.
 *
 * A helper rather than a bare `.rejects.toThrow(RpcException)`, because the
 * CODE is the contract: the gateway maps ALREADY_EXISTS to 409 and
 * FAILED_PRECONDITION to 400, so a test that only checks "it threw" would pass
 * while the client received the wrong HTTP status.
 */
async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('§2.1 Auth core (e2e)', () => {
  let fx: E2eFixture;
  let auth: AuthService;
  let sessions: SessionsService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    auth = fx.moduleRef.get(AuthService);
    sessions = fx.moduleRef.get(SessionsService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  // ---------------------------------------------------------------- register

  describe('register', () => {
    it('1. a matching allowedEmailDomains auto-joins that tenant', async () => {
      const org = await createOrganization(fx.prisma, {
        allowedEmailDomains: ['acme-join.test'],
      });

      const result = await auth.register(
        {
          email: 'newcomer@acme-join.test',
          password: TEST_PASSWORD,
          fullName: 'Newcomer',
        },
        requestOrigin(),
      );

      expect(result.organizationId).toBe(org.id);
    });

    it('1b. a domain-matched joiner gets End User, not Org Admin', async () => {
      // The distinction that stops "anyone with a matching address" from
      // owning the tenant.
      await createOrganization(fx.prisma, {
        allowedEmailDomains: ['acme-join2.test'],
      });

      const result = await auth.register(
        {
          email: 'joiner@acme-join2.test',
          password: TEST_PASSWORD,
          fullName: 'Joiner',
        },
        requestOrigin(),
      );

      const user = await fx.prisma.user.findUniqueOrThrow({
        where: { id: result.userId },
        include: { roles: true },
      });
      expect(user.roles.map((r) => r.name)).toEqual([SystemRoleName.END_USER]);
    });

    it('2. no matching domain creates a PENDING_ONBOARDING org', async () => {
      const result = await auth.register(
        {
          email: 'founder@brand-new.test',
          password: TEST_PASSWORD,
          fullName: 'Founder',
        },
        requestOrigin(),
      );

      const org = await fx.prisma.organization.findUniqueOrThrow({
        where: { id: result.organizationId },
      });
      expect(org.status).toBe(OrgStatus.PENDING_ONBOARDING);
      expect(org.allowedEmailDomains).toEqual(['brand-new.test']);
    });

    it('2b. the founder of a new tenant gets Org Admin', async () => {
      // Without this the workspace has no administrator and no path to one:
      // inviting an admin already requires `user.invite`.
      const result = await auth.register(
        {
          email: 'boss@fresh-tenant.test',
          password: TEST_PASSWORD,
          fullName: 'Boss',
        },
        requestOrigin(),
      );

      const user = await fx.prisma.user.findUniqueOrThrow({
        where: { id: result.userId },
        include: { roles: true },
      });
      expect(user.roles.map((r) => r.name)).toEqual([SystemRoleName.ORG_ADMIN]);
    });

    it('3. the same address twice IN ONE TENANT is ALREADY_EXISTS', async () => {
      await createOrganization(fx.prisma, {
        allowedEmailDomains: ['dupe.test'],
      });

      await auth.register(
        {
          email: 'twice@dupe.test',
          password: TEST_PASSWORD,
          fullName: 'First',
        },
        requestOrigin(),
      );

      await expectRpc(
        auth.register(
          {
            email: 'twice@dupe.test',
            password: TEST_PASSWORD,
            fullName: 'Second',
          },
          requestOrigin(),
        ),
        status.ALREADY_EXISTS,
      );
    });

    it('4. the same address in TWO tenants both succeed', async () => {
      // The contractor / re-hire case: uniqueness is per tenant (RDM §1.10).
      const orgA = await createOrganization(fx.prisma, {
        allowedEmailDomains: ['client-a.test'],
      });
      const orgB = await createOrganization(fx.prisma, {
        allowedEmailDomains: ['client-a.test'],
      });
      void orgB;

      const first = await auth.register(
        {
          email: 'contractor@client-a.test',
          password: TEST_PASSWORD,
          fullName: 'C',
        },
        requestOrigin(),
      );

      // The domain match resolves to ONE org, so the second account is created
      // directly — registration cannot target a specific tenant by design.
      const second = await createUserWithPassword(fx.prisma, {
        email: 'contractor@client-a.test',
        organizationId: orgB.id,
      });

      expect(first.organizationId).toBe(orgA.id);
      expect(second.organizationId).toBe(orgB.id);
      expect(
        await fx.prisma.user.count({
          where: { email: 'contractor@client-a.test' },
        }),
      ).toBe(2);
    });

    it('5. two CONCURRENT identical registrations leave exactly one row', async () => {
      // The only test that actually exercises `users_org_email_key`. The
      // service-layer findFirst cannot prevent this — both requests read
      // "free" — so if the partial index were missing, this would create two
      // accounts and no error, which is what a double-clicked submit produces.
      await createOrganization(fx.prisma, {
        allowedEmailDomains: ['race.test'],
      });

      const attempt = () =>
        auth.register(
          {
            email: 'racer@race.test',
            password: TEST_PASSWORD,
            fullName: 'Racer',
          },
          requestOrigin(),
        );

      const results = await Promise.allSettled([attempt(), attempt()]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // A clean ALREADY_EXISTS, not a raw P2002 leaking through as INTERNAL.
      expect(rpcCode(rejected[0].reason)).toBe(status.ALREADY_EXISTS);
      expect(
        await fx.prisma.user.count({ where: { email: 'racer@race.test' } }),
      ).toBe(1);
    });

    it('6. a soft-deleted address is re-registrable in that tenant', async () => {
      // The re-hire case `users_org_email_key`'s `WHERE deleted_at IS NULL`
      // exists for. A full unique index would keep the departed employee
      // enrolled forever.
      const org = await createOrganization(fx.prisma, {
        allowedEmailDomains: ['rehire.test'],
      });

      await createUserWithPassword(fx.prisma, {
        email: 'boomerang@rehire.test',
        organizationId: org.id,
        deletedAt: new Date(),
      });

      const result = await auth.register(
        {
          email: 'boomerang@rehire.test',
          password: TEST_PASSWORD,
          fullName: 'Back',
        },
        requestOrigin(),
      );

      expect(result.organizationId).toBe(org.id);
    });
  });

  // ------------------------------------------------------------------- login

  describe('login', () => {
    it("10. loginWithTenant refuses an org outside the token's verified set", async () => {
      const a = await seedTenantWithUser(fx.prisma);
      const b = await seedTenantWithUser(fx.prisma);

      // Same address in both tenants -> a genuine tenant-selection response.
      const email = 'multi@tenant-select.test';
      await fx.prisma.user.update({
        where: { id: a.user.id },
        data: { email },
      });
      await fx.prisma.user.update({
        where: { id: b.user.id },
        data: { email },
      });

      const login = await auth.login(
        { email, password: TEST_PASSWORD },
        requestOrigin(),
      );
      expect(login.requiresTenantSelection).toBe(true);

      // A third, unrelated tenant the token says nothing about.
      const outsider = await seedTenantWithUser(fx.prisma);

      await expectRpc(
        auth.loginWithTenant(
          {
            tenantSelectionToken: login.tenantSelectionToken!,
            organizationId: outsider.org.id,
          },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
    });

    it('11. tenant selection is resolved BEFORE 2FA is evaluated', async () => {
      // 2FA policy is a per-tenant setting, so it is unanswerable until the
      // tenant is known. If the order flipped, a user would be challenged by
      // whichever tenant happened to be read first.
      const enforcing = await seedTenantWithUser(fx.prisma, {
        organization: { enforceTwoFactor: true },
      });
      const relaxed = await seedTenantWithUser(fx.prisma);

      const email = 'both@order-check.test';
      await fx.prisma.user.updateMany({
        where: { id: { in: [enforcing.user.id, relaxed.user.id] } },
        data: { email },
      });

      const result = await auth.login(
        { email, password: TEST_PASSWORD },
        requestOrigin(),
      );

      expect(result.requiresTenantSelection).toBe(true);
      expect(result.requiresTwoFactor).toBe(false);
      expect(result.twoFactorToken).toBeFalsy();
    });

    it('12. every candidate is password-checked — no short-circuit on first match', async () => {
      // Stopping at the first match would make response time a side channel for
      // how many tenants own an address.
      //
      // Asserted behaviourally rather than by counting `bcrypt.compare` calls:
      // bcrypt's exports are non-configurable, so `jest.spyOn` on it throws
      // "Cannot redefine property". This is the stronger assertion anyway —
      // three accounts share one address, the FIRST and THIRD share a password,
      // and the second does not. A loop that stopped at the first match would
      // find one account and log straight in; only a loop that checks all three
      // finds two and asks which tenant.
      const first = await seedTenantWithUser(fx.prisma);
      const second = await seedTenantWithUser(fx.prisma, {
        password: 'DifferentPass1!',
      });
      const third = await seedTenantWithUser(fx.prisma);

      const email = 'triple@no-shortcircuit.test';
      await fx.prisma.user.updateMany({
        where: { id: { in: [first.user.id, second.user.id, third.user.id] } },
        data: { email },
      });

      const result = await auth.login(
        { email, password: TEST_PASSWORD },
        requestOrigin(),
      );

      expect(result.requiresTenantSelection).toBe(true);
      expect(result.tenants.map((t) => t.organizationId).sort()).toEqual(
        [first.org.id, third.org.id].sort(),
      );
    });

    it('13. a wrong password and an unknown address fail identically', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);

      const wrongPassword = auth
        .login(
          { email: user.email, password: 'NotThePassword1!' },
          requestOrigin(),
        )
        .catch((e: unknown) => e);
      const unknownAddress = auth
        .login(
          { email: 'nobody@nowhere.test', password: TEST_PASSWORD },
          requestOrigin(),
        )
        .catch((e: unknown) => e);

      const [a, b] = await Promise.all([wrongPassword, unknownAddress]);

      expect(rpcCode(a)).toBe(status.UNAUTHENTICATED);
      expect(rpcCode(b)).toBe(status.UNAUTHENTICATED);
      // Identical message too: a different one is an enumeration oracle even
      // when the status matches.
      expect((a as RpcException).getError()).toEqual(
        (b as RpcException).getError(),
      );
    });

    it('a locked account cannot log in', async () => {
      const { user } = await seedTenantWithUser(fx.prisma, {
        user: { isLocked: true },
      });

      await expectRpc(
        auth.login(
          { email: user.email, password: TEST_PASSWORD },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
    });

    it('a member of a FROZEN tenant cannot log in', async () => {
      const { user } = await seedTenantWithUser(fx.prisma, {
        organization: { status: OrgStatus.FROZEN },
      });

      await expectRpc(
        auth.login(
          { email: user.email, password: TEST_PASSWORD },
          requestOrigin(),
        ),
        status.PERMISSION_DENIED,
      );
    });
  });

  // ----------------------------------------------------------------- refresh

  describe('refresh', () => {
    it('14. an unknown hash is UNAUTHENTICATED', async () => {
      await expectRpc(
        auth.refreshToken(
          { refreshToken: 'not-a-real-token' },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
    });

    it('16. a live token rotates in place: same family, old row marked spent', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { session, refreshToken } = await createDeviceSession(
        fx.prisma,
        user.id,
      );

      const result = await auth.refreshToken({ refreshToken }, requestOrigin());

      const oldRow = await fx.prisma.deviceSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      const newRow = await fx.prisma.deviceSession.findUniqueOrThrow({
        where: { refreshTokenHash: hashToken(result.refreshToken) },
      });

      expect(oldRow.rotatedAt).not.toBeNull();
      expect(newRow.familyId).toBe(session.familyId);
      expect(result.refreshToken).not.toBe(refreshToken);
    });

    it('15. REPLAY of a spent token revokes the entire family', async () => {
      // The single most important test in this module. Presenting an
      // already-rotated token means either the attacker or the victim is
      // replaying — the family is compromised either way, so all of it dies.
      const { user } = await seedTenantWithUser(fx.prisma);
      const { session, refreshToken } = await createDeviceSession(
        fx.prisma,
        user.id,
      );

      const rotated = await auth.refreshToken(
        { refreshToken },
        requestOrigin(),
      );

      await expectRpc(
        auth.refreshToken({ refreshToken }, requestOrigin()),
        status.UNAUTHENTICATED,
      );

      // Not just the replayed row: the successor the legitimate client is
      // holding must die too, or the attacker keeps the session they stole.
      expect(
        await fx.prisma.deviceSession.count({
          where: { familyId: session.familyId },
        }),
      ).toBe(0);
      await expectRpc(
        auth.refreshToken(
          { refreshToken: rotated.refreshToken },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
    });

    it('an expired session is refused and the row removed', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { session, refreshToken } = await createDeviceSession(
        fx.prisma,
        user.id,
        {
          expiresAt: new Date(Date.now() - 1000),
        },
      );

      await expectRpc(
        auth.refreshToken({ refreshToken }, requestOrigin()),
        status.UNAUTHENTICATED,
      );
      expect(
        await fx.prisma.deviceSession.findUnique({ where: { id: session.id } }),
      ).toBeNull();
    });

    it('refresh is where a mid-session lock takes effect', async () => {
      // The access token cannot be recalled, so refresh is the enforcement
      // point — and it must kill every session, not just this one.
      const { user } = await seedTenantWithUser(fx.prisma);
      const { refreshToken } = await createDeviceSession(fx.prisma, user.id);
      await createDeviceSession(fx.prisma, user.id);

      await fx.prisma.user.update({
        where: { id: user.id },
        data: { isLocked: true },
      });

      await expectRpc(
        auth.refreshToken({ refreshToken }, requestOrigin()),
        status.UNAUTHENTICATED,
      );
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
  });

  // ------------------------------------------------------------------ logout

  describe('logout', () => {
    it('17. logout ends the presented session', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { session, refreshToken } = await createDeviceSession(
        fx.prisma,
        user.id,
      );
      await createDeviceSession(fx.prisma, user.id);

      const result = await auth.logout({ refreshToken, allDevices: false });

      expect(result.revokedSessionCount).toBe(1);
      expect(
        await fx.prisma.deviceSession.findUnique({ where: { id: session.id } }),
      ).toBeNull();
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: user.id } }),
      ).toBe(1);
    });

    it('17b. allDevices ends every session for that user', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { refreshToken } = await createDeviceSession(fx.prisma, user.id);
      await createDeviceSession(fx.prisma, user.id);
      await createDeviceSession(fx.prisma, user.id);

      const result = await auth.logout({ refreshToken, allDevices: true });

      expect(result.revokedSessionCount).toBe(3);
    });

    it('logout on an already-dead session reports success, not 404', async () => {
      const result = await auth.logout({
        refreshToken: 'long-gone',
        allDevices: false,
      });
      expect(result.revokedSessionCount).toBe(0);
    });

    it('18. logoutAll clears sessions AND device trust', async () => {
      // The lost-laptop button. Leaving `device_token_hash` alive would let
      // the thief skip 2FA on their next login, which defeats the point.
      const { user } = await seedTenantWithUser(fx.prisma);
      await createTrustedDeviceSession(fx.prisma, user.id);
      await createTrustedDeviceSession(fx.prisma, user.id);

      const result = await auth.logoutAll(
        memberContext({ id: user.id, organizationId: user.organizationId }),
      );

      expect(result.revokedSessionCount).toBe(2);
      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: user.id, deviceTokenHash: { not: null } },
        }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------- change password

  describe('changePassword', () => {
    it('19. a passwordless (Google-only) account is FAILED_PRECONDITION', async () => {
      const { org } = await seedTenantWithUser(fx.prisma);
      const googleUser = await fx.prisma.user.create({
        data: {
          email: 'google-only@oauth.test',
          fullName: 'Google Only',
          organizationId: org.id,
          passwordHash: null,
        },
      });

      await expectRpc(
        auth.changePassword(
          { currentPassword: 'anything', newPassword: 'Whatever1!' },
          memberContext({ id: googleUser.id, organizationId: org.id }),
        ),
        status.FAILED_PRECONDITION,
      );
    });

    it('20. a wrong current password is UNAUTHENTICATED', async () => {
      const { user, org } = await seedTenantWithUser(fx.prisma);

      await expectRpc(
        auth.changePassword(
          { currentPassword: 'WrongOne1!', newPassword: 'BrandNew1!' },
          memberContext({ id: user.id, organizationId: org.id }),
        ),
        status.UNAUTHENTICATED,
      );
    });

    it("21. success revokes every OTHER family and keeps the caller's own", async () => {
      // Distinct from a reset, which revokes everything: the actor here is
      // authenticated, so kicking them out of their own browser is hostile.
      const { user, org } = await seedTenantWithUser(fx.prisma);
      const mine = await createDeviceSession(fx.prisma, user.id);
      const other = await createDeviceSession(fx.prisma, user.id);
      const third = await createDeviceSession(fx.prisma, user.id);

      const result = await auth.changePassword(
        {
          currentPassword: TEST_PASSWORD,
          newPassword: 'BrandNewPass1!',
          refreshToken: mine.refreshToken,
        },
        memberContext({ id: user.id, organizationId: org.id }),
      );

      expect(result.revokedSessionCount).toBe(2);
      expect(
        await fx.prisma.deviceSession.findUnique({
          where: { id: mine.session.id },
        }),
      ).not.toBeNull();
      expect(
        await fx.prisma.deviceSession.findUnique({
          where: { id: other.session.id },
        }),
      ).toBeNull();
      expect(
        await fx.prisma.deviceSession.findUnique({
          where: { id: third.session.id },
        }),
      ).toBeNull();
    });

    it('21b. success tells the user, and the audit row carries no hash', async () => {
      const { user, org } = await seedTenantWithUser(fx.prisma);

      await auth.changePassword(
        { currentPassword: TEST_PASSWORD, newPassword: 'BrandNewPass1!' },
        memberContext({ id: user.id, organizationId: org.id }),
      );

      expect(fx.notifications.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          template: EmailTemplateName.PASSWORD_CHANGED,
          to: user.email,
        }),
      );

      const [, event] = fx.audit.record.mock.calls.at(-1) as [
        unknown,
        { metadata?: Record<string, unknown> },
      ];
      expect(JSON.stringify(event.metadata)).not.toContain('$2b$');
    });

    it('reusing the current password as the new one is INVALID_ARGUMENT', async () => {
      const { user, org } = await seedTenantWithUser(fx.prisma);

      await expectRpc(
        auth.changePassword(
          { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
          memberContext({ id: user.id, organizationId: org.id }),
        ),
        status.INVALID_ARGUMENT,
      );
    });
  });

  // --------------------------------------------------------- password reset

  describe('forgot / reset password', () => {
    it('22. an unknown address is accepted silently — no enumeration', async () => {
      await expect(
        auth.forgotPassword({ email: 'ghost@nowhere.test' }, requestOrigin()),
      ).resolves.toEqual({});
      expect(fx.notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('23. an address in two tenants gets ONE email with one labelled link each', async () => {
      const a = await seedTenantWithUser(fx.prisma);
      const b = await seedTenantWithUser(fx.prisma);
      const email = 'shared@reset-multi.test';
      await fx.prisma.user.updateMany({
        where: { id: { in: [a.user.id, b.user.id] } },
        data: { email },
      });

      await auth.forgotPassword({ email }, requestOrigin());

      // One message, not two near-identical ones the recipient cannot tell
      // apart.
      expect(fx.notifications.sendEmail).toHaveBeenCalledTimes(1);
      const [command] = fx.notifications.sendEmail.mock.calls[0] as [
        { data: { links: { organizationName: string; url: string }[] } },
      ];
      expect(command.data.links).toHaveLength(2);
      expect(command.data.links.map((l) => l.organizationName).sort()).toEqual(
        [a.org.name, b.org.name].sort(),
      );

      // One row per account, so each link resets its own tenant's password.
      expect(
        await fx.prisma.passwordResetToken.count({ where: { isUsed: false } }),
      ).toBe(2);
    });

    it('a locked account is skipped, still without saying so', async () => {
      const { user } = await seedTenantWithUser(fx.prisma, {
        user: { isLocked: true },
      });

      await expect(
        auth.forgotPassword({ email: user.email }, requestOrigin()),
      ).resolves.toEqual({});
      expect(fx.notifications.sendEmail).not.toHaveBeenCalled();
    });

    it('a fresh request invalidates the previous outstanding token', async () => {
      // Five clicks on "forgot password" must not leave five live tokens.
      const { user } = await seedTenantWithUser(fx.prisma);

      await auth.forgotPassword({ email: user.email }, requestOrigin());
      await auth.forgotPassword({ email: user.email }, requestOrigin());

      expect(
        await fx.prisma.passwordResetToken.count({
          where: { userId: user.id, isUsed: false },
        }),
      ).toBe(1);
    });

    it('24. a used or expired token validates as invalid', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);

      const used = await createPasswordResetToken(fx.prisma, user.id, {
        isUsed: true,
      });
      const expired = await createPasswordResetToken(fx.prisma, user.id, {
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        auth.validatePasswordResetToken({ token: used.token }),
      ).resolves.toEqual({ valid: false });
      await expect(
        auth.validatePasswordResetToken({ token: expired.token }),
      ).resolves.toEqual({ valid: false });
    });

    it('24b. a valid token returns a MASKED address, never the real one', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { token } = await createPasswordResetToken(fx.prisma, user.id);

      const result = await auth.validatePasswordResetToken({ token });

      expect(result.valid).toBe(true);
      // A stolen token must not become a way to read addresses out of the
      // database.
      expect(result.email).not.toBe(user.email);
      expect(result.email).toContain('*');
    });

    it('25. reset revokes EVERY session including trusted devices', async () => {
      // Unlike changePassword, the actor here is unauthenticated by
      // definition — there is no session that deserves sparing, and a trusted
      // device left alive lets the attacker back in without 2FA.
      const { user } = await seedTenantWithUser(fx.prisma);
      await createDeviceSession(fx.prisma, user.id);
      await createTrustedDeviceSession(fx.prisma, user.id);
      const { token } = await createPasswordResetToken(fx.prisma, user.id);

      const result = await auth.resetPassword({
        token,
        newPassword: 'AfterReset1!',
      });

      expect(result.revokedSessionCount).toBe(2);
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: user.id } }),
      ).toBe(0);
    });

    it('25b. the new password works and the old one does not', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { token } = await createPasswordResetToken(fx.prisma, user.id);

      await auth.resetPassword({ token, newPassword: 'AfterReset1!' });

      await expectRpc(
        auth.login(
          { email: user.email, password: TEST_PASSWORD },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
      await expect(
        auth.login(
          { email: user.email, password: 'AfterReset1!' },
          requestOrigin(),
        ),
      ).resolves.toMatchObject({ requiresTenantSelection: false });
    });

    it('a reset token is single-use', async () => {
      const { user } = await seedTenantWithUser(fx.prisma);
      const { token } = await createPasswordResetToken(fx.prisma, user.id);

      await auth.resetPassword({ token, newPassword: 'AfterReset1!' });

      await expectRpc(
        auth.resetPassword({ token, newPassword: 'AgainAgain1!' }),
        status.FAILED_PRECONDITION,
      );
    });
  });

  // ----------------------------------------------------------------- google

  describe('google sign-in', () => {
    it('26. a new address creates an account with passwordHash null', async () => {
      // Which is exactly what makes login()'s OAuth-only guard reject it from
      // the password path.
      const firebase = fx.moduleRef.get<{
        verifyGoogleIdToken: (t: string) => Promise<unknown>;
      }>(
        // Resolved by class through the module, so the stub replaces the real
        // Firebase call without the suite needing credentials.
        (await import('../../src/modules/firebase/firebase.service'))
          .FirebaseService,
      );
      jest.spyOn(firebase, 'verifyGoogleIdToken').mockResolvedValue({
        email: 'fresh@google-signin.test',
        fullName: 'Fresh Google',
        avatarUrl: null,
        emailVerified: true,
      });

      await auth.googleSignIn({ idToken: 'stub' }, requestOrigin());

      const created = await fx.prisma.user.findFirstOrThrow({
        where: { email: 'fresh@google-signin.test' },
      });
      expect(created.passwordHash).toBeNull();
      expect(created.isEmailVerified).toBe(true);
    });

    it('a Google-created account cannot then log in with a password', async () => {
      const { org } = await seedTenantWithUser(fx.prisma);
      const googleUser = await fx.prisma.user.create({
        data: {
          email: 'oauth-only@google-signin.test',
          fullName: 'OAuth Only',
          organizationId: org.id,
          passwordHash: null,
        },
      });
      void googleUser;

      await expectRpc(
        auth.login(
          { email: 'oauth-only@google-signin.test', password: TEST_PASSWORD },
          requestOrigin(),
        ),
        status.UNAUTHENTICATED,
      );
    });
  });

  // ---------------------------------------------------------------- fixtures

  describe('fixture sanity', () => {
    it('addMember grants a real seeded system role, not a look-alike', async () => {
      const { org } = await seedTenantWithUser(fx.prisma);
      const admin = await addMember(fx.prisma, org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
      });

      const withRoles = await fx.prisma.user.findUniqueOrThrow({
        where: { id: admin.id },
        include: { roles: true },
      });
      expect(withRoles.roles[0].organizationId).toBeNull();
      expect(withRoles.roles[0].isSystemRole).toBe(true);
    });

    it('hashTestPassword produces a hash the service accepts', async () => {
      const hash = await hashTestPassword();
      const { user } = await seedTenantWithUser(fx.prisma);
      await fx.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash },
      });

      await expect(
        auth.login(
          { email: user.email, password: TEST_PASSWORD },
          requestOrigin(),
        ),
      ).resolves.toMatchObject({ requiresTwoFactor: false });
    });

    it('sessions service is reachable for the §3.1 suite', () => {
      expect(sessions).toBeDefined();
    });
  });
});
