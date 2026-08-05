export const MIN_FULL_NAME_LENGTH = 2;
export const MAX_FULL_NAME_LENGTH = 150;

export const MAX_DEVICE_NAME_LENGTH = 100;

/**
 * Upper bound on one invitation batch.
 *
 * Guards the REQUEST BODY, not the seat quota — `organizations.max_agent_seats`
 * is what limits how many invitations may actually exist, and auth-service
 * enforces that. This only stops a single call arriving with 50,000 addresses.
 */
export const MAX_INVITATIONS_PER_BATCH = 200;

export const MIN_DEPARTMENT_NAME_LENGTH = 2;
/** Matches `departments.name` — `@db.VarChar(100)`. A longer value would pass
 * validation and then fail as a Postgres error, which reads as a 500. */
export const MAX_DEPARTMENT_NAME_LENGTH = 100;

/**
 * Upper bound on one "add members" call. Guards the REQUEST BODY only; the
 * tenant check on every id is what enforces correctness.
 */
export const MAX_DEPARTMENT_MEMBERS_PER_BATCH = 500;

export const MIN_ROLE_NAME_LENGTH = 2;
/** Matches `roles.name` — `@db.VarChar(100)`. */
export const MAX_ROLE_NAME_LENGTH = 100;

// SORT_ORDER_OPTIONS / SortOrder / DEFAULT_SEARCH moved to @synapsedesk/common:
// auth-service clamps `limit` a second time (it is reachable over gRPC, where no
// ValidationPipe ever ran), and two copies of MAX_LIMIT is how the edge and the
// service end up disagreeing about what "too many" means.

export type ApiSuccessResponse<T = any> = {
  success: boolean;
  statusCode: number;
  message: string;
  warning: string | null;
  data: T;
};

export type ApiErrorResponse = {
  success: boolean;
  statusCode: number;
  path: string;
  timestamp: string;
  error: string;
};

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * The strict tier, applied ONLY to routes marked `@AuthThrottle()`.
 *
 * Its name is load-bearing: `SmartThrottlerGuard` routes tiers by comparing
 * against it, so a typo would silently apply the loose general limits to the
 * login endpoint.
 */
export const AUTH_THROTTLER_TIER = 'authTier';

/** The blunt backstop every authenticated route gets. */
export const GENERAL_THROTTLER_TIERS = ['short', 'medium', 'long'] as const;

/**
 * Per-route limits the endpoint plan promises (see the remaining-work doc).
 *
 * Declared here rather than inline at each `@Throttle()` so the whole policy is
 * readable in one place — a limit is a product decision, and hunting six
 * controllers to answer "how many login attempts do we allow?" is how the
 * answer drifts.
 *
 * Every one of these is an OVERRIDE of `authTier`, keyed by that exact name:
 * `@Throttle()` merges by tier name, so overriding under any other key would
 * add a fourth tier instead of replacing the strict one.
 */
export const ROUTE_THROTTLE = {
  /** Credential stuffing. */
  login: { ttl: 15 * 60_000, limit: 5 },
  register: { ttl: 15 * 60_000, limit: 5 },
  /** Mail bomb, and an account-enumeration probe if unlimited. */
  forgotPassword: { ttl: 60 * 60_000, limit: 3 },
  /**
   * An online password oracle for an attacker who already holds a session —
   * the current-password check is what makes it one, and this is what stops it
   * being cheap.
   */
  changePassword: { ttl: 15 * 60_000, limit: 5 },
  /** SMS pumping. This one costs real money per request. */
  otpRequest: { ttl: 10 * 60_000, limit: 3 },
  /** Second line behind `otps.max_attempts`. */
  otpVerify: { ttl: 10 * 60_000, limit: 10 },
  /** Token guessing here discloses the customer list. */
  invitationPreview: { ttl: 60 * 60_000, limit: 20 },
  /** Mail bomb aimed at one invitee. */
  invitationResend: { ttl: 60 * 60_000, limit: 3 },
  /** Brute-forcing the second factor. */
  twoFactorAuthenticate: { ttl: 15 * 60_000, limit: 10 },
} as const;

/** A document belongs to a handful of departments, not hundreds. */
export const MAX_DOCUMENT_DEPARTMENTS = 50;
