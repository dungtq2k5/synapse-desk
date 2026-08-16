import { Injectable, Logger } from '@nestjs/common';
import {
  CallerContext,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  GoogleSignInRequest,
  LoginRequest,
  LoginResponse,
  LoginWithTenantRequest,
  LogoutAllResponse,
  LogoutRequest,
  LogoutResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  UserResponse,
  ValidatePasswordResetTokenRequest,
  ValidatePasswordResetTokenResponse,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {
  AuditAction,
  AuditResourceType,
  EmailTemplateName,
  JwtPayload,
  OrgStatus,
  RequestOrigin,
  SystemRoleName,
  TenantSelectionJwtPayload,
  TwoFactorJwtPayload,
  WEB_ROUTES,
  extractEmailDomain,
  extractEmailLocalPart,
  isUniqueConstraintViolation,
  normalizeEmail,
  requireActor,
  tenantScope,
} from '@synapsedesk/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  addDays,
  addMinutes,
  stripTrailingSlashes,
  generateSecureToken,
  generateUniqueOrganizationSlug,
  hashToken,
  maskEmail,
  flattenPermissionCodes,
} from '../../common/utils';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Prisma } from '../../generated/prisma/client';
import { toUserResponse } from '../users/user.mapper';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import { OtpService } from '../otp/otp.service';
import { RolesService } from '../roles/roles.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuditPublisher } from '../audit/audit-publisher.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import {
  FirebaseService,
  type GoogleIdentity,
} from '../firebase/firebase.service';

/**
 * Everything `buildJwtPayload` and `toUserResponse` need, derived from the
 * query rather than hand-written so the two can never drift apart.
 */
const USER_WITH_ACCESS = {
  organization: true,
  userDepartments: true,
  roles: { include: { permissions: true } },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{
  include: typeof USER_WITH_ACCESS;
}>;

/**
 * A freshly minted session. `sessionId` is what lets the 2FA flow mark this
 * exact device trusted after the challenge succeeds.
 */
export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: UserResponse;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly JWT_2FA_EXPIRES_IN: string;
  private readonly JWT_TENANT_SELECTION_EXPIRES_IN: string;
  private readonly JWT_2FA_PRIVATE_KEY: Buffer;
  /** Derived from the private half — see TwoFactorAuthService for the reasoning. */
  private readonly JWT_2FA_PUBLIC_KEY: string;
  private readonly BCRYPT_ROUNDS: number;
  private readonly REFRESH_TOKEN_TTL_DAYS: number;
  private readonly TRUSTED_DEVICE_TTL_DAYS: number;
  private readonly PASSWORD_RESET_TTL_MINUTES: number;
  private readonly APP_WEB_URL: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationPublisher,
    private readonly firebase: FirebaseService,
    private readonly otpService: OtpService,
    private readonly rolesService: RolesService,
    private readonly sessionsService: SessionsService,
    private readonly audit: AuditPublisher,
    // Login and register embed a user, so they need avatars resolved too — a
    // raw object path is the same leak there as on GET /users/me.
    private readonly storage: StorageReferenceService,
  ) {
    this.JWT_2FA_EXPIRES_IN =
      this.configService.getOrThrow<string>('JWT_2FA_EXPIRES_IN');
    this.JWT_TENANT_SELECTION_EXPIRES_IN =
      this.configService.getOrThrow<string>('JWT_TENANT_SELECTION_EXPIRES_IN');
    this.JWT_2FA_PRIVATE_KEY = readFileSync(
      this.configService.getOrThrow<string>('JWT_2FA_PRIVATE_KEY_PATH'),
    );
    this.JWT_2FA_PUBLIC_KEY = createPublicKey(this.JWT_2FA_PRIVATE_KEY)
      .export({ type: 'spki', format: 'pem' })
      .toString();
    this.BCRYPT_ROUNDS = this.configService.getOrThrow<number>('BCRYPT_ROUNDS');
    this.REFRESH_TOKEN_TTL_DAYS = this.configService.getOrThrow<number>(
      'REFRESH_TOKEN_TTL_DAYS',
    );
    this.TRUSTED_DEVICE_TTL_DAYS = this.configService.getOrThrow<number>(
      'TRUSTED_DEVICE_TTL_DAYS',
    );
    this.PASSWORD_RESET_TTL_MINUTES = this.configService.getOrThrow<number>(
      'PASSWORD_RESET_TTL_MINUTES',
    );
    this.APP_WEB_URL = stripTrailingSlashes(
      this.configService.getOrThrow<string>('APP_WEB_URL'),
    );
  }

  /**
   * Register a new user. Auto-joins a tenant when the email domain matches
   * `allowed_email_domains`; otherwise creates a PENDING_ONBOARDING org.
   *
   * **Verification is NOT a precondition of logging in**, and that is a
   * deliberate choice rather than an omission. Requesting and submitting a
   * verification code both require a session (`/auth/email/verify*` sit behind
   * JwtAuthGuard), so blocking login until verified would deadlock: no token
   * without verifying, no verifying without a token.
   *
   * Instead the account is usable immediately but LIMITED — `isEmailVerified`
   * rides in the JWT and `EmailVerifiedGuard` in the gateway gates the routes
   * that need a proven address. Registration dispatches the first code straight
   * away so the user never has to go looking for it.
   */
  async register(
    registerRequest: RegisterRequest,
    device: RequestOrigin,
  ): Promise<RegisterResponse> {
    const { password, fullName } = registerRequest;
    const email = normalizeEmail(registerRequest.email);

    // The conflict check has MOVED into the transaction below. It cannot run
    // here any more: "is this address taken?" is only answerable once the
    // tenant is known, and the tenant is resolved inside that transaction.
    const emailDomain = extractEmailDomain(email);
    if (!emailDomain) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Email is not valid',
      });
    }

    const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);

    const user = await this.createUserInResolvedTenant({
      email,
      fullName,
      passwordHash,
      emailDomain,
    });

    // Published AFTER the transaction commits, never inside it. Emitting from
    // within would announce an account that a later rollback erases — and the
    // recipient cannot un-read an email.
    this.notifications.sendEmail({
      template: EmailTemplateName.WELCOME,
      to: user.created.email,
      data: {
        fullName: user.created.fullName,
        organizationName: user.organizationName,
        // Quoted back in the "wasn't you?" footer, which is what makes an
        // unexpected registration actionable rather than merely alarming.
        origin: device,
      },
    });

    // Sent immediately rather than waiting for the user to hunt for a "verify"
    // button. Failure here must not fail the registration, so it is caught: the
    // account exists and the code can always be re-requested.
    try {
      await this.otpService.requestEmailVerification({
        userId: user.created.id,
      });
    } catch (error) {
      this.logger.error(
        `Registered ${user.created.id} but could not dispatch the verification code: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      userId: user.created.id,
      email: user.created.email,
      organizationId: user.created.organizationId!,
      requiresEmailVerification: true,
    };
  }

  /**
   * Resolves the tenant, then creates the user inside the SAME transaction.
   *
   * The order matters: the conflict check is only answerable once the tenant is
   * known, so it cannot live in `register()` before this runs.
   *
   * Two layers guard uniqueness and they have different jobs. The `findFirst`
   * below produces a good error in the 99.99% non-racing case; the P2002 catch
   * turns the race-loser's constraint violation into the same clean response.
   * Only `users_org_email_key` actually PREVENTS the duplicate — two concurrent
   * requests both see "free", and that is what a double-clicked submit button
   * produces.
   */
  private async createUserInResolvedTenant(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    emailDomain: string;
  }): Promise<{
    created: {
      id: string;
      email: string;
      fullName: string;
      organizationId: string | null;
    };
    organizationName: string;
  }> {
    const { email, fullName, passwordHash, emailDomain } = input;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingOrg = await tx.organization.findFirst({
          where: {
            allowedEmailDomains: { has: emailDomain },
            deletedAt: null,
          },
          select: { id: true, name: true },
        });

        const org =
          existingOrg ??
          (await tx.organization.create({
            data: {
              name: `Workspace for ${email}`,
              slug: generateUniqueOrganizationSlug(email),
              status: OrgStatus.PENDING_ONBOARDING,
              allowedEmailDomains: [emailDomain],
            },
            select: { id: true, name: true },
          }));

        // Whoever CREATES a tenant becomes its Org Admin; everyone who joins an
        // existing one by domain match gets End User.
        //
        // Without this a self-registered workspace has no administrator at all:
        // nobody can invite, create a department, or complete onboarding, and
        // there is no other path to the first admin because inviting one
        // already requires `user.invite`. Domain-matched joiners must NOT get
        // it — that would hand full tenant control to anyone with a matching
        // address.
        const isFounder = existingOrg === null;

        // Now that the tenant is known, the conflict question is answerable.
        const existing = await tx.user.findFirst({
          where: { email, organizationId: org.id, deletedAt: null },
          select: { id: true },
        });
        if (existing) {
          throw new RpcException({
            code: status.ALREADY_EXISTS,
            message: 'Email already registered',
          });
        }

        const roleId = await this.rolesService.getSystemRoleId(
          isFounder ? SystemRoleName.ORG_ADMIN : SystemRoleName.END_USER,
          tx,
        );

        // `select`, not `include: USER_WITH_ACCESS`. The caller reads four
        // scalars off this row and never touches the relations, so including
        // them fetched an organization, every department and every role WITH
        // its permissions to throw all of it away.
        //
        // It also cost correctness noise: a multi-relation include issues its
        // relation loads concurrently, and inside a transaction those land on
        // the single connection the transaction has pinned — which pg only
        // tolerates by queueing them, a queue it removes in pg@9.
        const created = await tx.user.create({
          data: {
            organizationId: org.id,
            fullName,
            email,
            passwordHash,
            isEmailVerified: false,
            roles: { connect: { id: roleId } },
          },
          select: {
            id: true,
            email: true,
            fullName: true,
            organizationId: true,
          },
        });

        return { created, organizationName: org.name };
      });
    } catch (error) {
      // The `findFirst` above IS the manual detection, and it handles every
      // non-racing case. What it cannot do is be atomic: two concurrent
      // registrations both read "free" and both insert, which is exactly what a
      // double-clicked submit button produces. `users_org_email_key` is the only
      // thing that makes that impossible; this turns the loser's violation into
      // the same clean 409 the pre-check produces.
      if (isUniqueConstraintViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'Email already registered',
        });
      }
      throw error;
    }
  }

  /**
   * Login with email + password. Returns tokens and optional 2FA challenge.
   *
   * An unverified email is deliberately NOT a reason to refuse. The endpoints
   * that verify it require a session, so refusing here would leave the user
   * with no way to ever verify. `isEmailVerified` travels in the JWT instead,
   * and `EmailVerifiedGuard` gates the individual routes that require a proven
   * address — the account is usable, just limited.
   */
  async login(
    loginRequest: LoginRequest,
    device: RequestOrigin,
  ): Promise<LoginResponse> {
    const { password, deviceName, deviceToken } = loginRequest;
    const email = normalizeEmail(loginRequest.email);

    // findMany, not findUnique: an address is unique per TENANT now, so one
    // address may legitimately name several accounts.
    const candidates = await this.prisma.user.findMany({
      where: { email, deletedAt: null },
      // Roles, permissions and departments are loaded here because
      // buildJwtPayload needs them. Without this include the token ships with
      // `permissionCodes: []` and PermissionGuard denies everything, with
      // nothing in the logs to explain why.
      include: USER_WITH_ACCESS,
    });

    const matched: UserWithAccess[] = [];
    for (const candidate of candidates) {
      // OAuth-only account: no password to compare against.
      if (!candidate.passwordHash) continue;
      if (await bcrypt.compare(password, candidate.passwordHash)) {
        matched.push(candidate);
      }
      // Deliberately NOT short-circuiting on the first match. Stopping early
      // would make response time a side channel for how many tenants own an
      // address.
    }

    if (matched.length === 0) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }

    if (matched.length > 1) {
      // The tenant list is emitted ONLY after a password verified. Without that
      // ordering this response would be an unauthenticated "which tenants own
      // this address?" oracle.
      return {
        requiresTwoFactor: false,
        requiresTwoFactorSetup: false,
        requiresTenantSelection: true,
        tenantSelectionToken: this.generateTenantSelectionToken(
          matched.map((candidate) => candidate.id),
        ),
        tenants: matched.map((candidate) => ({
          organizationId: candidate.organization!.id,
          name: candidate.organization!.name,
          slug: candidate.organization!.slug,
        })),
        user: undefined,
      };
    }

    return this.completeLogin(matched[0], device, {
      deviceName,
      deviceToken,
    });
  }

  /**
   * Second leg of a multi-tenant login: the caller picks which account to use.
   *
   * Authorized by the tenant-selection token, never by the supplied
   * organizationId alone — the id is a claim, the token is proof that a password
   * already matched these specific accounts.
   */
  async loginWithTenant(
    request: LoginWithTenantRequest,
    device: RequestOrigin,
  ): Promise<LoginResponse> {
    let payload: TenantSelectionJwtPayload;
    try {
      payload = this.jwtService.verify<TenantSelectionJwtPayload>(
        request.tenantSelectionToken,
        {
          publicKey: this.JWT_2FA_PUBLIC_KEY,
          algorithms: ['RS256'],
        },
      );
    } catch {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }

    // A 2FA challenge token is signed by the same keypair, so the signature
    // alone does not distinguish them — this claim does.
    if (payload.purpose !== 'tenant_selection') {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: {
        // Constrained to the verified set: an organizationId outside it cannot
        // select anything, however well-formed the request looks.
        id: { in: payload.userIds },
        organizationId: request.organizationId,
        deletedAt: null,
      },
      include: USER_WITH_ACCESS,
    });
    if (!user) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }

    return this.completeLogin(user, device, {
      deviceName: request.deviceName,
      deviceToken: request.deviceToken,
    });
  }

  /**
   * Clears a lock whose `lockedUntil` has passed, mechanism 1.
   *
   * **Both columns are cleared together.** Leaving `lockedUntil` set on an
   * unlocked account would let a later indefinite re-lock silently inherit an
   * expiry nobody asked for — the same reasoning as §2.4's rule for manual
   * unlocks.
   *
   * **Returns whether the lock is still IN FORCE, not whether this call did the
   * write.** The distinction is the whole correctness of the race, and getting
   * it backwards is a real bug this had: at expiry the hourly sweep and the
   * user's login attempt are independent and routinely land together, so when
   * the sweep wins, `updateMany` matches zero rows here. Reporting that as "the
   * lock stands" refuses a login whose lock had genuinely expired — the user
   * sees "Account is locked", tries again, and it works, which is the kind of
   * fault nobody can reproduce or report usefully.
   *
   * The write stays CONDITIONAL so the two mechanisms produce one unlock rather
   * than two; `count` decides who writes the audit row, never who may log in.
   */
  private async expireLockIfLapsed(user: {
    id: string;
    isLocked: boolean;
    lockedUntil: Date | null;
  }): Promise<boolean> {
    if (!user.isLocked || !user.lockedUntil) return false;
    if (user.lockedUntil.getTime() > Date.now()) return false;

    await this.prisma.user.updateMany({
      where: { id: user.id, isLocked: true },
      data: { isLocked: false, lockedUntil: null },
    });

    // The lock had lapsed before this call started. Whether this statement or
    // the sweep's is the one that cleared the row does not change that.
    return true;
  }

  /**
   * The shared tail of every successful first-factor check: locked → frozen →
   * 2FA → session.
   *
   * Extracted because three paths reach it — password login, tenant selection
   * and Google sign-in — and the checks are per-TENANT. `enforce_two_factor` in
   * particular is an organization setting, so it is unanswerable until the
   * tenant is known, which is why none of it can run before selection.
   */
  private async completeLogin(
    user: UserWithAccess,
    device: RequestOrigin,
    client: { deviceName?: string; deviceToken?: string },
  ): Promise<LoginResponse> {
    // **Lazy unlock, before the check**
    //
    // The one place where being locked matters in real time, so the expiry is
    // honoured the moment the user tries to use it, with no dependency on a
    // job having run. The hourly sweep covers what this cannot: a user whose
    // lock expired but who never attempts a login stays *listed* as locked and
    // excluded from notification audiences until something else notices.
    //
    // Deliberately BEFORE the `isLocked` check rather than folded into it. The
    // check stays a plain boolean read, which is what keeps the other 20 read
    // sites in this system untouched.
    if (await this.expireLockIfLapsed(user)) {
      user.isLocked = false;
    }

    if (user.isLocked) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Account is locked',
      });
    }

    if (user.organization?.status === OrgStatus.FROZEN) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Organization access temporarily disabled',
      });
    }

    // Two DIFFERENT reasons to challenge, and the client has to tell them apart:
    //   - the user enrolled voluntarily          -> ask for a code
    //   - the TENANT requires it, user has none  -> send them to enrolment
    // Collapsing them is what turns `enforce_two_factor` into a tenant-wide
    // lockout: everyone without a secret gets a code prompt for a code that
    // does not exist, and there is no other door.
    const requiresSetup =
      user.organization?.enforceTwoFactor === true && !user.isTwoFactorEnabled;
    const enforces2fa = user.isTwoFactorEnabled || requiresSetup;

    if (
      enforces2fa &&
      !(await this.isTrustedDevice(user.id, client.deviceToken))
    ) {
      return {
        requiresTwoFactor: true,
        requiresTwoFactorSetup: requiresSetup,
        requiresTenantSelection: false,
        twoFactorToken: this.generate2faToken(user.id),
        tenants: [],
        user: undefined,
      };
    }

    const session = await this.issueSession(user, {
      name: client.deviceName,
      ...device,
    });

    return {
      requiresTwoFactor: false,
      requiresTwoFactorSetup: false,
      requiresTenantSelection: false,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tenants: [],
      user: session.user,
    };
  }

  /**
   * Sign in (or sign up) with a Google account, via a Firebase ID token.
   *
   * Deliberately one endpoint for both: Google has already proven ownership of
   * the address, so there is nothing for a separate "register" step to verify,
   * and forcing one would only invite users to create a duplicate account.
   *
   * Accounts created this way have `passwordHash = null`, which is exactly what
   * makes `login()`'s OAuth-only guard reject them from the password path.
   */
  async googleSignIn(
    request: GoogleSignInRequest,
    device: RequestOrigin,
  ): Promise<LoginResponse> {
    const identity = await this.firebase.verifyGoogleIdToken(request.idToken);
    const emailDomain = extractEmailDomain(identity.email);
    if (!emailDomain) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Google account email is not valid',
      });
    }

    // `deletedAt: null` is now IN the query rather than checked afterwards.
    // Loading soft-deleted rows and rejecting them later took a measurably
    // different path for a deactivated account than for an unknown one — a
    // subtle enumeration difference.
    //
    // findMany because the address may name accounts in several tenants. Google
    // proves the address, not which tenant is meant, so the same selection step
    // as password login applies.
    const candidates = await this.prisma.user.findMany({
      where: { email: identity.email, deletedAt: null },
      include: USER_WITH_ACCESS,
    });

    if (candidates.length > 1) {
      return {
        requiresTwoFactor: false,
        requiresTwoFactorSetup: false,
        requiresTenantSelection: true,
        tenantSelectionToken: this.generateTenantSelectionToken(
          candidates.map((candidate) => candidate.id),
        ),
        tenants: candidates.map((candidate) => ({
          organizationId: candidate.organization!.id,
          name: candidate.organization!.name,
          slug: candidate.organization!.slug,
        })),
        user: undefined,
      };
    }

    const user = candidates[0]
      ? await this.linkGoogleIdentity(candidates[0], identity)
      : await this.createUserFromGoogle(identity, device, emailDomain);

    // Same tail as password login — locked, frozen, 2FA, session.
    return this.completeLogin(user, device, {
      deviceName: request.deviceName,
      deviceToken: request.deviceToken,
    });
  }

  // Email and phone verification live in `modules/otp/otp.service.ts`, exposed
  // over gRPC by OtpService: they own the `otps` table, its attempt counter and
  // the NATS dispatch, none of which the session lifecycle here touches.

  /**
   * End a session.
   *
   * Authenticated by POSSESSION of the refresh token rather than by an access
   * token: the access token is short-lived and may already have expired at the
   * moment the user clicks "log out", and refusing to log someone out because
   * their access token lapsed is exactly backwards.
   *
   * Always reports success. A logout that 404s on an already-dead session tells
   * the caller nothing useful and leaves cookies in place; the desired end
   * state — no session — is reached either way.
   */
  async logout(request: LogoutRequest): Promise<LogoutResponse> {
    const session = await this.prisma.deviceSession.findUnique({
      where: { refreshTokenHash: hashToken(request.refreshToken) },
      select: { id: true, userId: true },
    });
    if (!session) return { revokedSessionCount: 0 };

    const { count } = await this.prisma.deviceSession.deleteMany({
      where: request.allDevices
        ? { userId: session.userId }
        : { id: session.id },
    });

    return { revokedSessionCount: count };
  }

  /**
   * "Log out of every device" (RDM) — the stolen-laptop button.
   *
   * Keyed off the AUTHENTICATED caller rather than a presented refresh token,
   * unlike `logout`. That is the whole point: someone reaching for this has
   * usually lost the device holding the refresh cookie, so requiring one would
   * fail exactly when it is needed.
   *
   * Takes device TRUST with it — `revokeAllForUser` deletes the rows, and
   * `device_token_hash` lives on them. Leaving trust intact would let the thief
   * skip 2FA on their next login, which defeats the entire purpose.
   */
  async logoutAll(context: CallerContext): Promise<LogoutAllResponse> {
    const userId = requireActor(context);
    const count = await this.sessionsService.revokeAllForUser(userId);

    this.audit.record(context, {
      action: AuditAction.USER_LOGOUT_ALL,
      resourceType: AuditResourceType.USER,
      resourceId: userId,
      metadata: { revokedSessionCount: count },
    });

    return { revokedSessionCount: count };
  }

  /**
   * Change a password when the caller KNOWS the current one.
   *
   * Distinct from `resetPassword`, whose actor is unauthenticated by
   * definition — which is why that one revokes every session and this one
   * spares the caller's own. Verifying the current password is what stops a
   * hijacked session from being upgraded into permanent account takeover, so it
   * is not a usability nicety.
   */
  async changePassword(
    request: ChangePasswordRequest,
    context: CallerContext,
  ): Promise<ChangePasswordResponse> {
    const userId = requireActor(context);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...tenantScope(context) },
      select: { id: true, email: true, fullName: true, passwordHash: true },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Account not found',
      });
    }

    // A Google-only account has no password to verify. Told plainly rather than
    // failed as a bad-credentials error, which would send them hunting for a
    // password that never existed.
    if (!user.passwordHash) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message:
          'This account has no password. Use the password reset flow to set one.',
      });
    }

    const matches = await bcrypt.compare(
      request.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Current password is incorrect',
      });
    }

    if (request.newPassword === request.currentPassword) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'The new password must differ from the current one',
      });
    }

    const passwordHash = await bcrypt.hash(
      request.newPassword,
      this.BCRYPT_ROUNDS,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Everyone EXCEPT this caller. If the password was changed because it was
    // compromised, every other session is suspect; kicking this one too would
    // just be hostile.
    const revokedSessionCount =
      await this.sessionsService.revokeAllExceptFamily(
        user.id,
        request.refreshToken,
      );

    this.notifications.sendEmail({
      template: EmailTemplateName.PASSWORD_CHANGED,
      to: user.email,
      data: {
        fullName: user.fullName,
        revokedSessionCount,
        origin: { ip: context.ip, userAgent: context.userAgent },
      },
    });

    this.audit.record(context, {
      action: AuditAction.PASSWORD_CHANGED,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
      // NEVER the hash, old or new (see the conventions). The count is the
      // only fact here worth recording.
      metadata: { revokedSessionCount },
    });

    return { revokedSessionCount };
  }

  /**
   * Exchange a refresh token for a new pair, rotating the old one.
   *
   * Rotation plus reuse detection is what makes an opaque refresh token worth
   * having. Each use burns the presented token and issues a successor in the
   * same `familyId`. If a token that has already been rotated is presented
   * again, exactly one of two things happened — an attacker replayed a stolen
   * token, or the legitimate user replayed one after the attacker rotated it —
   * and in both cases the family is compromised, so all of it dies and the user
   * must log in again.
   */
  async refreshToken(
    request: RefreshTokenRequest,
    device: RequestOrigin,
  ): Promise<RefreshTokenResponse> {
    const presentedHash = hashToken(request.refreshToken);

    const session = await this.prisma.deviceSession.findUnique({
      where: { refreshTokenHash: presentedHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        rotatedAt: true,
        deviceName: true,
        isTrusted: true,
        deviceTokenHash: true,
        trustedUntil: true,
      },
    });

    if (!session) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid refresh token',
      });
    }

    if (session.rotatedAt) {
      // Replay of an already-spent token: burn the whole family.
      await this.prisma.deviceSession.deleteMany({
        where: { familyId: session.familyId },
      });
      this.logger.warn(
        `Refresh token reuse detected for user ${session.userId}; ` +
          `revoked session family ${session.familyId}`,
      );

      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Refresh token has already been used',
      });
    }

    if (session.expiresAt <= new Date()) {
      await this.prisma.deviceSession.delete({ where: { id: session.id } });
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Session has expired',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId, deletedAt: null },
      include: USER_WITH_ACCESS,
    });
    if (!user || user.isLocked) {
      // Locked or deleted mid-session: the refresh is where that takes effect,
      // since the already-issued access token cannot be recalled.
      await this.prisma.deviceSession.deleteMany({
        where: { userId: session.userId },
      });
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Account is no longer active',
      });
    }

    const refreshToken = generateSecureToken();

    await this.prisma.$transaction(async (tx) => {
      // The old row is retained, marked spent, so a later replay is DETECTABLE.
      // Deleting it would make replay indistinguishable from an unknown token.
      await tx.deviceSession.update({
        where: { id: session.id },
        data: { rotatedAt: new Date() },
      });

      await tx.deviceSession.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          refreshTokenHash: hashToken(refreshToken),
          deviceName: session.deviceName,
          ipAddress: device.ip,
          userAgent: device.userAgent,
          // Device trust rides along with the family, so refreshing does not
          // silently re-prompt for 2FA.
          isTrusted: session.isTrusted,
          deviceTokenHash: session.deviceTokenHash,
          trustedUntil: session.trustedUntil,
          expiresAt: addDays(new Date(), this.REFRESH_TOKEN_TTL_DAYS),
        },
      });
    });

    return {
      accessToken: this.generateAccessToken(this.buildJwtPayload(user)),
      refreshToken,
      user: toUserResponse(
        user,
        // Pre-auth path: no CallerContext exists yet, so the tenant comes
        // from the row. See `resolveOwnReadUrls`.
        await this.storage.resolveOwnReadUrls(
          user.avatarUrl ? [user.avatarUrl] : [],
          user.organizationId,
          user.id,
        ),
      ),
    };
  }

  /**
   * Grant "remember this device" to an existing session and return the raw
   * device token for the gateway to store in its own HttpOnly cookie.
   *
   * Two rules from Step 5.2 are enforced here rather than left to the caller:
   * trust is only ever granted on an existing session (i.e. after a completed
   * 2FA challenge), and `trustedUntil` is capped at the configured horizon
   * instead of inheriting the session's own, longer, expiry.
   *
   * Called by `TwoFactorAuthService.authenticateTwoFactor` when the user ticks
   * "remember this device" — the only path that reaches it, and the only place
   * a device token is ever minted.
   */
  async trustDevice(userId: string, deviceSessionId: string): Promise<string> {
    const deviceToken = generateSecureToken();

    await this.prisma.deviceSession.update({
      where: { id: deviceSessionId, userId },
      data: {
        isTrusted: true,
        deviceTokenHash: hashToken(deviceToken),
        trustedUntil: addDays(new Date(), this.TRUSTED_DEVICE_TTL_DAYS),
      },
    });

    return deviceToken;
  }

  /**
   * Mint the access/refresh pair and record the session.
   *
   * The refresh token is opaque random bytes, NOT a JWT. That is the whole
   * point: it is looked up in `device_sessions` on every use and can therefore
   * be revoked instantly, whereas a JWT validates itself and stays valid until
   * it expires no matter what the server wants.
   */
  async issueSession(
    user: UserWithAccess,
    device: RequestOrigin & { name?: string },
  ): Promise<IssuedSession> {
    const accessToken = this.generateAccessToken(this.buildJwtPayload(user));
    const refreshToken = generateSecureToken();

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deviceSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: hashToken(refreshToken),
          deviceName: device.name,
          ipAddress: device.ip,
          userAgent: device.userAgent,
          // Trust is granted only after a successful 2FA challenge with
          // explicit consent — never as a side effect of logging in.
          isTrusted: false,
          expiresAt: addDays(new Date(), this.REFRESH_TOKEN_TTL_DAYS),
        },
        select: { id: true },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      return created;
    });

    return {
      accessToken,
      refreshToken,
      // Returned so the 2FA flow can mark THIS session trusted; there is no
      // other way to name the row it just created.
      sessionId: session.id,
      user: toUserResponse(
        user,
        // Pre-auth path: no CallerContext exists yet, so the tenant comes
        // from the row. See `resolveOwnReadUrls`.
        await this.storage.resolveOwnReadUrls(
          user.avatarUrl ? [user.avatarUrl] : [],
          user.organizationId,
          user.id,
        ),
      ),
    };
  }

  /** Loads a user with everything the JWT payload and mapper need. */
  async loadUserForAuth(userId: string): Promise<UserWithAccess> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: USER_WITH_ACCESS,
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    return user;
  }

  /**
   * Step 1 of the reset flow. ALWAYS succeeds, whether or not the address
   * exists — otherwise this endpoint is the account-enumeration oracle avoided
   * everywhere else.
   */
  async forgotPassword(
    request: ForgotPasswordRequest,
    device: RequestOrigin,
  ): Promise<ForgotPasswordResponse> {
    const email = normalizeEmail(request.email);

    // findMany: one address may hold accounts in several tenants, and each
    // needs its own reset token.
    const users = await this.prisma.user.findMany({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        isLocked: true,
        organization: { select: { name: true } },
      },
    });

    // Unchanged contract: ALWAYS accepted, whether or not anything matched.
    // Throwing NOT_FOUND here — as this used to — turns the endpoint into an
    // account-enumeration oracle, and a locked account must not be
    // distinguishable from a missing one either.
    if (users.length === 0) return {};

    const links = await Promise.all(
      users
        .filter((user) => !user.isLocked)
        .map(async (user) => ({
          organizationName: user.organization?.name ?? 'your account',
          url: await this.issueResetToken(user.id, device),
        })),
    );

    if (links.length === 0) return {};

    // ONE email with one labelled link per organization, not N near-identical
    // messages the recipient cannot tell apart.
    this.notifications.sendEmail({
      template: EmailTemplateName.PASSWORD_RESET,
      to: users[0].email,
      data: {
        fullName: users[0].fullName,
        links,
        expiresInMinutes: this.PASSWORD_RESET_TTL_MINUTES,
        origin: device,
      },
    });

    return {};
  }

  /**
   * Issues one reset token and returns the SPA link carrying it.
   *
   * The link points at the SPA, not the API — a mail client can only issue a
   * GET, so it has to land on a page where a new password can be typed. That
   * page then calls GET /auth/password/reset/:token to pre-validate and
   * POST /auth/password/reset to submit. The path comes from the shared
   * WEB_ROUTES map so the link and the SPA router cannot drift apart.
   */
  private async issueResetToken(
    userId: string,
    device: RequestOrigin,
  ): Promise<string> {
    const token = generateSecureToken();

    await this.prisma.$transaction(async (tx) => {
      // Five clicks on "forgot password" must not leave five live tokens.
      await tx.passwordResetToken.updateMany({
        where: { userId, isUsed: false },
        data: { isUsed: true },
      });

      await tx.passwordResetToken.create({
        data: {
          userId,
          // Only the hash is stored. The raw token exists in the email and
          // nowhere else.
          tokenHash: hashToken(token),
          ipAddress: device.ip,
          userAgent: device.userAgent,
          expiresAt: addMinutes(new Date(), this.PASSWORD_RESET_TTL_MINUTES),
        },
      });
    });

    return `${this.APP_WEB_URL}${WEB_ROUTES.resetPassword}?token=${encodeURIComponent(token)}`;
  }

  /**
   * Pre-flight for the reset form, so the UI can show 410 Gone before the user
   * types a new password into a dead form.
   */
  async validatePasswordResetToken(
    request: ValidatePasswordResetTokenRequest,
  ): Promise<ValidatePasswordResetTokenResponse> {
    const record = await this.findUsablePasswordResetToken(request.token);
    if (!record) return { valid: false };

    // Masked: a stolen token must not become a way to read addresses out of
    // the database.
    return { valid: true, email: maskEmail(record.user.email) };
  }

  /**
   * Step 2 of the reset flow. One transaction, three effects — and the third
   * is the one that matters.
   */
  async resetPassword(
    request: ResetPasswordRequest,
  ): Promise<ResetPasswordResponse> {
    const record = await this.findUsablePasswordResetToken(request.token);
    if (!record) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Password reset link is invalid or has expired',
      });
    }

    const passwordHash = await bcrypt.hash(
      request.newPassword,
      this.BCRYPT_ROUNDS,
    );

    return this.prisma.$transaction(async (tx) => {
      // Invalidate all reset tokens for this user (including the one used)
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId },
        data: { isUsed: true },
      });

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });

      // The point of the whole flow. A reset that leaves the attacker's
      // session alive accomplishes nothing — and that includes their trusted
      // devices, which would otherwise let them back in without 2FA.
      const { count } = await tx.deviceSession.deleteMany({
        where: { userId: record.userId },
      });

      return { revokedSessionCount: count };
    });
  }

  /**
   * "Remember this device for 30 days" — suppresses the 2FA prompt.
   *
   * Identified ONLY by a secret the server issued and the client stores in its
   * own HttpOnly cookie. Never by `deviceName` or the user-agent: those are
   * attacker-supplied strings, so trusting them would mean anyone who guesses
   * that the victim uses "Chrome on macOS" skips 2FA entirely.
   *
   * The lookup is a plain indexed read because `deviceTokenHash` is SHA-256 of
   * the presented value — deterministic, and therefore findable.
   */
  private async isTrustedDevice(
    userId: string,
    deviceToken: string | undefined,
  ): Promise<boolean> {
    if (!deviceToken) return false;

    const trusted = await this.prisma.deviceSession.findFirst({
      where: {
        userId,
        isTrusted: true,
        deviceTokenHash: hashToken(deviceToken),
        trustedUntil: { gt: new Date() },
      },
      select: { id: true },
    });

    return Boolean(trusted);
  }

  /** Shared lookup: unused, unexpired, and belonging to a live account. */
  private async findUsablePasswordResetToken(token: string) {
    if (!token) return null;

    return this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: hashToken(token),
        isUsed: false,
        expiresAt: { gt: new Date() },
        user: { deletedAt: null, isLocked: false },
      },
      include: { user: { select: { email: true } } },
    });
  }

  private buildJwtPayload(user: UserWithAccess): JwtPayload {
    return {
      sub: user.id,
      organizationId: user.organizationId,
      isSuperAdmin: user.isSuperAdmin,
      departmentIds: user.userDepartments.map((ud) => ud.departmentId),
      isEmailVerified: user.isEmailVerified,
      // Shared with UserService.GetUserPermissions. Two copies of this would
      // drift silently: the token would grant a set the "what can this user
      // do?" endpoint disagrees with, and only one of them decides reality.
      permissionCodes: flattenPermissionCodes(user.roles),
    };
  }

  private generateAccessToken(payload: JwtPayload): string {
    // TTL comes from AuthModule; setting expiresIn here would override it.
    return this.jwtService.sign(payload);
  }

  /**
   * The 2FA challenge token: RS256, signed with its OWN key pair.
   *
   * Its own, not the access token's, and that is the point — the SIGNATURE now
   * distinguishes the two token types, so a challenge token simply does not
   * verify where an access token is expected. Sharing one pair worked but left
   * the `is2faPending` claim checks load-bearing: one forgotten check anywhere
   * and a half-authenticated caller passes as a complete one. Separate keys make
   * those checks defence-in-depth instead of the only line of defence, and let
   * either pair be rotated without invalidating the other's tokens.
   */
  /**
   * Short-lived proof that these user ids already passed a password check.
   *
   * Without it, `POST /auth/login/tenant` would accept any organizationId for
   * any address and become exactly the "which tenants own this address?" oracle
   * the two-step flow exists to prevent.
   *
   * Signed with the 2FA keypair rather than a third one: same trust domain —
   * pre-authentication, short-lived, minted and verified only by this service.
   * `purpose` is the discriminant that stops a 2FA token being presented here
   * and vice versa, the same job `is2faPending` does for the other.
   */
  private generateTenantSelectionToken(userIds: string[]): string {
    return this.jwtService.sign(
      {
        userIds,
        purpose: 'tenant_selection',
      } satisfies TenantSelectionJwtPayload,
      {
        privateKey: this.JWT_2FA_PRIVATE_KEY,
        algorithm: 'RS256',
        expiresIn: this.JWT_TENANT_SELECTION_EXPIRES_IN,
      } as JwtSignOptions,
    );
  }

  private generate2faToken(userId: string): string {
    return this.jwtService.sign(
      {
        sub: userId,
        is2faPending: true,
      } satisfies TwoFactorJwtPayload,
      {
        privateKey: this.JWT_2FA_PRIVATE_KEY,
        algorithm: 'RS256',
        expiresIn: this.JWT_2FA_EXPIRES_IN,
      } as JwtSignOptions,
    );
  }

  /**
   * Backfills profile fields Google can supply and we do not have yet.
   *
   * Only ever FILLS GAPS: a name the user has since edited here is never
   * overwritten from their Google profile, because ours is the more deliberate
   * choice.
   *
   * `avatar_url` is deliberately NOT backfilled. It holds an internal storage
   * object path, and `identity.avatarUrl` is Google's CDN URL — a different
   * kind of value entirely. Storing it made the column mean two things, so
   * `organizationIdFromObjectPath` and `resolveReadUrls` silently mishandled
   * those rows, and replacing such an avatar emitted an external URL as an
   * `objectPath` to storage-service's delete path. A Google user has no avatar
   * until they upload one through presign -> confirm.
   */
  private async linkGoogleIdentity(
    user: UserWithAccess,
    identity: GoogleIdentity,
  ): Promise<UserWithAccess> {
    const patch: Prisma.UserUpdateInput = {};

    // Google has already verified the address, so our own email OTP is
    // redundant for this user.
    if (!user.isEmailVerified && identity.emailVerified) {
      patch.isEmailVerified = true;
    }

    if (Object.keys(patch).length === 0) return user;

    // Write, then re-read. A write carrying a multi-relation include makes
    // Prisma open an implicit transaction and load the relations concurrently
    // on its one connection — the pg deprecation. Two plain statements instead.
    await this.prisma.user.update({
      where: { id: user.id },
      data: patch,
      select: { id: true },
    });

    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: USER_WITH_ACCESS,
    });
  }

  /**
   * First Google sign-in: creates the account under the same tenant-resolution
   * and default-role rules as `register()`, so a Google user is not a
   * second-class citizen with no organization and no role (which would leave
   * them with an empty `permissionCodes` and a 403 on everything).
   */
  private async createUserFromGoogle(
    identity: GoogleIdentity,
    device: RequestOrigin,
    emailDomain: string,
  ): Promise<UserWithAccess> {
    const created = await this.prisma.$transaction(async (tx) => {
      const org =
        (await tx.organization.findFirst({
          where: { allowedEmailDomains: { has: emailDomain }, deletedAt: null },
          select: { id: true, name: true },
        })) ||
        (await tx.organization.create({
          data: {
            name: `Workspace for ${identity.email}`,
            slug: generateUniqueOrganizationSlug(identity.email),
            status: OrgStatus.PENDING_ONBOARDING,
            allowedEmailDomains: [emailDomain],
          },
          select: { id: true, name: true },
        }));

      const endUserRoleId = await this.rolesService.getEndUserRoleId(tx);

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          email: identity.email,
          // Google may withhold the name; the local part is a usable stand-in
          // and fullName is NOT NULL. Same helper the inbound-email path uses,
          // because it is the same question with a different provider.
          fullName:
            identity.fullName ??
            extractEmailLocalPart(identity.email) ??
            identity.email,
          // No `avatarUrl` — see linkGoogleIdentity. Google's CDN URL is not a
          // storage object path, and this column holds only the latter.
          passwordHash: null,
          isEmailVerified: identity.emailVerified,
          roles: { connect: { id: endUserRoleId } },
        },
        select: { id: true },
      });

      return { userId: user.id, organizationName: org.name };
    });

    // Hydrated AFTER the transaction. Unlike the password path, the relations
    // really are needed here — buildJwtPayload reads them — so the read stays,
    // it just moves off the transaction's single pinned connection, where the
    // include's concurrent relation loads had to queue behind one another.
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: created.userId },
      include: USER_WITH_ACCESS,
    });

    this.notifications.sendEmail({
      template: EmailTemplateName.WELCOME,
      to: user.email,
      data: {
        fullName: user.fullName,
        organizationName: created.organizationName,
        origin: device,
      },
    });

    return user;
  }
}
