import {
  otpControllerGetOtpStatusV1,
  usersControllerGetCurrentUserV1,
  type LoginResponseDto,
  type TenantOptionResponseDto,
  type TenantSelectionResponseDto,
  type TwoFactorRequiredResponseDto,
} from '@synapsedesk/api-client';

/**
 * Where a signed-in user lands when no `next` says otherwise: the root, which
 * sends an agent to Tickets and anyone else to Ask.
 */
export const HOME = '/';

/**
 * The `next` a sign-in returns to, if it's a path on this origin. Anything
 * else (`//evil.example`, `/\evil.example`, `https://…`) is the home page, so
 * the sign-in page can't be used to send someone elsewhere.
 *
 * @example safeNext('/tickets/42?tab=notes') // '/tickets/42?tab=notes'
 * @example safeNext('//evil.example') // '/'
 */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith('/') || /^\/[/\\]/.test(next)) return HOME;
  return next;
}

/**
 * Where a person goes once signed in: "Verify your email" first while the code
 * sent at sign-up is still out and the address unverified, then `next`;
 * otherwise `next`. (An address can be verified with a code still out: Google
 * sign-in verifies it too.) The app works unverified (the banner asks), so a
 * failed check goes straight on.
 */
export async function afterSignIn(next: string): Promise<string> {
  try {
    const answer = await otpControllerGetOtpStatusV1({
      purpose: 'EMAIL_VERIFICATION',
    });
    if (
      answer.data?.pending &&
      !(await usersControllerGetCurrentUserV1()).data?.user.isEmailVerified
    ) {
      return `/verify-email?next=${encodeURIComponent(next)}`;
    }
  } catch {
    // Unverified is allowed; the banner says so.
  }
  return next;
}

/** What a sign-in leg answered, as the step the user takes next. */
export type SignInStep =
  | { kind: 'signed-in' }
  | { kind: 'code' }
  | { kind: 'setup' }
  | { kind: 'tenant'; tenants: TenantOptionResponseDto[] };

/**
 * Reads `POST /auth/login` (or `/auth/login/tenant`): signed in, a two-step
 * code, two-step setup (the organization requires it and this account has
 * none), or a choice of organization.
 *
 * @example signInStep({ requiresTwoFactor: true, requiresTwoFactorSetup: false }) // { kind: 'code' }
 */
export function signInStep(
  answer:
    | LoginResponseDto
    | TwoFactorRequiredResponseDto
    | TenantSelectionResponseDto,
): SignInStep {
  if ('requiresTenantSelection' in answer && answer.requiresTenantSelection) {
    return { kind: 'tenant', tenants: answer.tenants };
  }
  if ('requiresTwoFactorSetup' in answer && answer.requiresTwoFactorSetup) {
    return { kind: 'setup' };
  }
  if ('requiresTwoFactor' in answer && answer.requiresTwoFactor) {
    return { kind: 'code' };
  }
  return { kind: 'signed-in' };
}

/**
 * The label the sessions list shows for this device, e.g. "Chrome on macOS".
 * A label only: the server never trusts it.
 *
 * @example deviceName('Mozilla/5.0 (Macintosh; …) Chrome/141.0 Safari/537.36') // 'Chrome on macOS'
 */
export function deviceName(userAgent: string): string {
  const browser = first(BROWSERS, userAgent) ?? 'Browser';
  const system = first(SYSTEMS, userAgent);
  return system ? `${browser} on ${system}` : browser;
}

// Order matters: Edge's agent also says Chrome, and Chrome's says Safari.
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

function first(table: [RegExp, string][], text: string): string | null {
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** The minutes a `Retry-After` of this many seconds reads as, at least 1. */
export function minutesFrom(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/** A plausible email address: what the field checks before sending. */
export const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
