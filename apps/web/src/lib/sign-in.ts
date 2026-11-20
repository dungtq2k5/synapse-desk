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

/** A stand-in origin `next` is resolved against; it never leaves this file. */
const SAME_ORIGIN = 'https://synapsedesk.invalid';

/** The longest `next` kept; a longer one is the home page. */
const NEXT_MAX = 2000;

/**
 * The `next` a sign-in returns to, if it's a path on this origin, so the
 * sign-in page can't be used to send someone elsewhere.
 *
 * Resolved the way the browser will resolve it, and kept only when the origin
 * is unchanged: the URL parser drops a tab or newline (`/\t/evil.example` is
 * `//evil.example`) and reads `\` as `/`, which no prefix rule keeps up with.
 * A path whose decoded form starts `//` or `/\`, and anything over
 * {@link NEXT_MAX} characters, is the home page too.
 *
 * @example safeNext('/tickets/42?tab=notes') // '/tickets/42?tab=notes'
 * @example safeNext('/\t/evil.example') // '/'
 */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith('/') || next.length > NEXT_MAX) return HOME;
  let url: URL;
  try {
    url = new URL(next, SAME_ORIGIN);
  } catch {
    return HOME;
  }
  if (url.origin !== SAME_ORIGIN) return HOME;
  if (/^\/[/\\]/.test(safeDecode(url.pathname))) return HOME;
  return url.pathname + url.search + url.hash;
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
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
  | { kind: 'code'; canRememberDevice: boolean }
  | { kind: 'setup'; superAdmin: boolean }
  | { kind: 'tenant'; tenants: TenantOptionResponseDto[] };

/**
 * Reads `POST /auth/login` (or `/auth/login/tenant`): signed in, a two-step
 * code, two-step setup (the organization requires it, or it's a Super Admin,
 * and this account has none), or a choice of organization. Only a Super
 * Admin's challenge can't remember the device, which is how setup knows to
 * use their wording.
 *
 * @example signInStep({ requiresTwoFactor: true, requiresTwoFactorSetup: false, canRememberDevice: true }) // { kind: 'code', canRememberDevice: true }
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
  const canRememberDevice =
    'canRememberDevice' in answer ? answer.canRememberDevice : true;
  if ('requiresTwoFactorSetup' in answer && answer.requiresTwoFactorSetup) {
    return { kind: 'setup', superAdmin: !canRememberDevice };
  }
  if ('requiresTwoFactor' in answer && answer.requiresTwoFactor) {
    return { kind: 'code', canRememberDevice };
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
