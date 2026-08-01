export const NODE_ENV_OPTIONS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENV_OPTIONS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const COOKIE_SAMESITE_OPTIONS = ['strict', 'lax', 'none'] as const;
export type CookieSameSite = (typeof COOKIE_SAMESITE_OPTIONS)[number];

export enum Gender {
  UNSPECIFIED = 'UNSPECIFIED',
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export enum OrgStatus {
  PENDING_ONBOARDING = 'PENDING_ONBOARDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED_PAST_DUE = 'SUSPENDED_PAST_DUE',
  FROZEN = 'FROZEN',
}

export type JwtPayload = {
  sub: string;
  organizationId: string | null;
  isSuperAdmin: boolean;
  departmentIds: string[];
  permissionCodes: PermissionCode[];

  /**
   * Carried in the token so `EmailVerifiedGuard` can gate a route without a
   * round trip to auth-service on every request.
   *
   * The trade-off is staleness: the claim is only as fresh as the access token,
   * so a user who has just verified keeps the old value until the token
   * rotates. That is why verifying tells the client to call `POST /auth/refresh`
   * — the rotation is what picks up the new claim.
   */
  isEmailVerified: boolean;
};

export type TwoFactorJwtPayload = Pick<JwtPayload, 'sub'> & {
  is2faPending: true;
};

/**
 * Short-lived proof that a set of user ids has ALREADY passed a password check.
 *
 * Issued when one address + password matches accounts in several tenants. It is
 * what stops `POST /auth/login/tenant` from being an unauthenticated "which
 * tenants own this address?" oracle: without it that endpoint would accept any
 * organizationId for any address.
 *
 * `purpose` is the discriminant that keeps it distinct from a 2FA challenge —
 * the same job `is2faPending` does for TwoFactorJwtPayload, and necessary
 * because both are signed by the same pre-auth keypair.
 */
export type TenantSelectionJwtPayload = {
  userIds: string[];
  purpose: 'tenant_selection';
};

/**
 * What Passport may have written to `req.user` — which depends on WHICH strategy
 * authorized the route, so only `sub` is guaranteed.
 *
 * The 2FA challenge token is a genuinely different shape: no organization, no
 * departments, no permission codes, because a caller mid-challenge has none.
 * Declaring `req.user` as a full `JwtPayload` would let a half-authenticated
 * request be read as a complete one with silently empty permissions — which is
 * an authorization bypass, not a typing inconvenience.
 */
export type MaybeJwtPayload = Partial<JwtPayload> & {
  sub: string;
  is2faPending?: true;
};

/**
 * Narrows `req.user` to a fully authenticated caller.
 *
 * Checks for the ABSENCE of `is2faPending` rather than the presence of
 * `permissionCodes`: a legitimate user may hold zero permissions (the End User
 * role grants none), so presence-of-permissions is not the distinction.
 */
export function isFullJwtPayload(
  payload: MaybeJwtPayload | undefined,
): payload is MaybeJwtPayload & JwtPayload {
  return (
    payload !== undefined &&
    payload.is2faPending !== true &&
    payload.permissionCodes !== undefined &&
    payload.departmentIds !== undefined
  );
}

export type RequestContext = JwtPayload & {
  ip: string;
  userAgent: string;
};

/**
 * Where a request came from, as OBSERVED by the gateway rather than claimed by
 * the caller. The subset of RequestContext that exists even when nobody is
 * authenticated, which is why login and password-reset can carry it.
 *
 * Defined once here because auth-service writes it to `device_sessions` and
 * `password_reset_tokens`, and the gateway derives it from Express — three
 * copies of `Pick<RequestContext, 'ip' | 'userAgent'>` is three chances to
 * drift.
 */
export type RequestOrigin = Pick<RequestContext, 'ip' | 'userAgent'>;

/**
 * gRPC metadata keys carrying RequestContext across a service hop.
 *
 * Metadata is stringly-typed: a typo on either side does not fail, it silently
 * yields an empty string and the audit row is quietly wrong. Sharing the keys
 * as constants is what makes that a compile error instead.
 */
export const GRPC_CONTEXT_METADATA = {
  userId: 'user_id',
  organizationId: 'organization_id',
  isSuperAdmin: 'is_super_admin',
  departmentIds: 'department_ids',
  permissionCodes: 'permission_codes',
  isEmailVerified: 'is_email_verified',
  ip: 'ip_address',
  userAgent: 'user_agent',
} as const;

/**
 * The canonical permission registry (api-endpoints-plan §9), in `target.action`
 * form per RDM Table 6.
 *
 * This array is the single source of truth twice over: it derives the
 * `PermissionCode` union used by `@RequirePermission`, and it is the seed input
 * for the `permissions` table — so a typo'd code fails at compile time instead
 * of silently 403-ing at runtime.
 *
 * Platform Super Admin routes (`/platform/*`) are NOT represented here: they are
 * gated by `users.is_super_admin`, not by RBAC rows.
 */
export const PERMISSION_CODES = [
  // Organization (own tenant)
  'organization.read',
  'organization.update',
  'organization.delete',

  // Departments
  'department.read',
  'department.create',
  'department.update',
  'department.delete',
  'department.member.assign',

  // Users & identity administration
  'user.read',
  'user.create',
  'user.update',
  'user.delete',
  'user.invite',
  'user.lock',
  'user.role.assign',
  'user.2fa.reset',
  'user.session.read',
  'user.session.revoke',

  // Roles & RBAC
  'role.read',
  'role.create',
  'role.update',
  'role.delete',
  'role.permission.assign',

  // Tickets
  'ticket.read.all',
  'ticket.create',
  'ticket.update',
  'ticket.delete',
  'ticket.assign',
  'ticket.assign.self',
  'ticket.reassign',
  'ticket.escalate',
  'ticket.resolve',
  'ticket.export',
  'ticket.ai.use',
  'ticket.message.moderate',

  // Knowledge base documents
  'document.read',
  'document.create',
  'document.update',
  'document.delete',
  'document.share',
  'document.reindex',

  // Analytics & compliance
  'analytics.read',
  'audit.read',
  'audit.export',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

/**
 * Human-readable labels written to `permissions.name`. Drives the role-editor
 * UI (`GET /permissions`), which groups rows by the `target` prefix of the code.
 */
export const PERMISSION_NAMES: Record<PermissionCode, string> = {
  'organization.read': 'View Organization Settings',
  'organization.update': 'Update Organization Settings',
  'organization.delete': 'Offboard Organization',

  'department.read': 'View Departments',
  'department.create': 'Create Departments',
  'department.update': 'Update Departments',
  'department.delete': 'Delete Departments',
  'department.member.assign': 'Assign Department Members',

  'user.read': 'View Users',
  'user.create': 'Create Users',
  'user.update': 'Update Users',
  'user.delete': 'Deactivate Users',
  'user.invite': 'Invite Users',
  'user.lock': 'Lock and Unlock Users',
  'user.role.assign': 'Assign User Roles',
  'user.2fa.reset': 'Reset User Two-Factor Auth',
  'user.session.read': 'View User Sessions',
  'user.session.revoke': 'Revoke User Sessions',

  'role.read': 'View Roles',
  'role.create': 'Create Roles',
  'role.update': 'Update Roles',
  'role.delete': 'Delete Roles',
  'role.permission.assign': 'Assign Role Permissions',

  'ticket.read.all': 'View All Tickets',
  'ticket.create': 'Create Tickets',
  'ticket.update': 'Update Tickets',
  'ticket.delete': 'Delete Tickets',
  'ticket.assign': 'Assign Tickets',
  'ticket.assign.self': 'Claim Tickets',
  'ticket.reassign': 'Reassign Tickets',
  'ticket.escalate': 'Escalate Tickets',
  'ticket.resolve': 'Resolve Tickets',
  'ticket.export': 'Export Tickets',
  'ticket.ai.use': 'Use AI Co-Pilot',
  'ticket.message.moderate': 'Moderate Ticket Messages',

  'document.read': 'View Documents',
  'document.create': 'Upload Documents',
  'document.update': 'Update Documents',
  'document.delete': 'Delete Documents',
  'document.share': 'Share Documents With Departments',
  'document.reindex': 'Reindex Documents',

  'analytics.read': 'View Analytics',
  'audit.read': 'View Audit Logs',
  'audit.export': 'Export Audit Logs',
};

/**
 * Global system roles — `organization_id IS NULL`, `is_system_role = true`.
 * Seeded once by auth-service and shared by every tenant; tenant admins may not
 * rename or delete them (api-endpoints-plan §1.7).
 *
 * The value IS the `roles.name` column, so it is also what the UI displays.
 */
export enum SystemRoleName {
  ORG_ADMIN = 'Org Admin',
  KNOWLEDGE_MANAGER = 'Knowledge Manager',
  SUPPORT_AGENT = 'Support Agent (Tier 2)',
  END_USER = 'End User',
}

/**
 * Default grants per system role (api-endpoints-plan §9).
 *
 * END_USER holds no permission rows on purpose: own-ticket access, `/chat/*`
 * and `/knowledge/search` are authorized by ownership and tenancy, not RBAC.
 * It exists so every registered user has a role to carry.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<
  SystemRoleName,
  readonly PermissionCode[]
> = {
  [SystemRoleName.ORG_ADMIN]: PERMISSION_CODES,

  [SystemRoleName.KNOWLEDGE_MANAGER]: [
    'document.read',
    'document.create',
    'document.update',
    'document.delete',
    'document.share',
    'document.reindex',
    'analytics.read',
    'ticket.read.all',
  ],

  [SystemRoleName.SUPPORT_AGENT]: [
    'ticket.read.all',
    'ticket.create',
    'ticket.update',
    'ticket.assign',
    'ticket.assign.self',
    'ticket.reassign',
    'ticket.escalate',
    'ticket.resolve',
    'ticket.ai.use',
    'ticket.message.moderate',
    'document.read',
    'user.read',
  ],

  [SystemRoleName.END_USER]: [],
};

export const SYSTEM_ROLE_DESCRIPTIONS: Record<SystemRoleName, string> = {
  [SystemRoleName.ORG_ADMIN]:
    'Full administrative control over the tenant: members, roles, departments, knowledge base and billing settings.',
  [SystemRoleName.KNOWLEDGE_MANAGER]:
    'Curates the knowledge base — uploads and scopes documents, monitors content quality and answer analytics.',
  [SystemRoleName.SUPPORT_AGENT]:
    'Tier 2 human agent: works the ticket queue, reassigns across departments and uses the AI co-pilot.',
  [SystemRoleName.END_USER]:
    'Default role for every registered member: raises tickets, chats with the AI assistant and searches the knowledge base.',
};

/** Mirrors the `invitation_status` Postgres enum. */
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum OtpPurpose {
  EMAIL_VERIFICATION = 'email_verification',
  PHONE_VERIFICATION = 'phone_verification',
}
export const OTP_PURPOSES = [
  OtpPurpose.EMAIL_VERIFICATION,
  OtpPurpose.PHONE_VERIFICATION,
] as const;

/**
 * SPA routes that BACKEND-generated links point at.
 *
 * These are frontend paths, not API endpoints — a password-reset email has to
 * open a page where the user can type a new password, not POST to an API. They
 * live here so the email builder and the SPA router are driven by one list
 * rather than two string literals that silently drift apart.
 */
export const WEB_ROUTES = {
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  acceptInvitation: '/invitations/accept',
} as const;

/**
 * Stand-in for provenance we genuinely do not have — a notification triggered
 * by a background job or an already-authenticated action where the device is not
 * the point.
 *
 * Frozen and shared rather than an inline `{ ip: '', userAgent: '' }` default:
 * an inline literal allocates on every call and is mutable, so anything
 * downstream could modify what the signature presents as a constant.
 */
export const UNKNOWN_ORIGIN: Readonly<RequestOrigin> = Object.freeze({
  ip: '',
  userAgent: '',
});
