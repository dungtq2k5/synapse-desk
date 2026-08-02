import { HttpException } from '@nestjs/common';

/**
 * Extract domain from email
 * @param email Email string
 * @returns Domain string or null if invalid email
 */
/**
 * The single normalization applied to every address before it is stored or
 * compared (RDM §1.10).
 *
 * Shared rather than per-service because the partial unique index
 * `users_org_email_key` is byte-exact: if register lower-cases and invite does
 * not, `John@acme.com` and `john@acme.com` become two accounts in one tenant
 * and the index never notices. Apply at EVERY entry point — register, login,
 * invite, forgot-password, OAuth, seed.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function extractEmailDomain(email: string): string | null {
  if (!email) return null;

  const domain = email.split('@')[1];
  return domain || null;
}

export function formatErrorMsg(
  err: unknown,
  exceptionMsg: string = 'An unknown error occurred',
): string {
  // No `= ''` initializer: the chain below ends in a bare `else`, so every path
  // assigns. Seeding it with a value only hides a missing branch if one is ever
  // added — TypeScript's definite-assignment analysis catches that, an empty
  // string does not.
  let formattedMsg: string;

  if (err instanceof HttpException) {
    const res = err.getResponse() as string | { message?: unknown };

    if (typeof res === 'string') {
      formattedMsg = res;
    } else if (res && typeof res === 'object' && 'message' in res) {
      const msg = res.message;
      if (Array.isArray(msg)) {
        formattedMsg = msg.join(', ');
      } else if (typeof msg === 'string') {
        formattedMsg = msg;
      } else {
        formattedMsg = err.message;
      }
    } else {
      formattedMsg = err.message;
    }
  } else if (err instanceof Error) {
    formattedMsg = err.message;
  } else if (err && typeof err === 'object' && 'message' in err) {
    const msg = err.message;
    if (Array.isArray(msg)) {
      formattedMsg = msg.join(', ');
    } else if (typeof msg === 'string') {
      formattedMsg = msg;
    } else {
      formattedMsg = String(msg);
    }
  } else if (typeof err === 'string') {
    formattedMsg = err;
  } else {
    formattedMsg = exceptionMsg;
  }

  // Convert to string safely
  const str = String(formattedMsg);
  let end = str.length;

  // Trim trailing '.', '!', and '?' from the end without regex overhead
  while (
    end > 0 &&
    (str[end - 1] === '.' || str[end - 1] === '!' || str[end - 1] === '?')
  ) {
    end--;
  }

  // Slice the cleaned string and append the single definitive exclamation mark
  return str.slice(0, end) + '!';
}

/**
 * Hides most of a phone number while leaving the last digits, which is how
 * users recognize their own: `+447700900123` -> `+44******0123`.
 */
export function maskPhoneNumber(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  if (trimmed.length <= 6) return '***';

  const prefix = trimmed.startsWith('+')
    ? trimmed.slice(0, 3)
    : trimmed.slice(0, 2);
  const suffix = trimmed.slice(-4);

  return `${prefix}${'*'.repeat(Math.max(3, trimmed.length - prefix.length - 4))}${suffix}`;
}

/**
 * Trims a string value, leaving anything else alone for the validators to
 * reject.
 *
 * Trimming BEFORE validation is the point: without it `"  "` satisfies
 * `@MinLength(2)` and reaches the service as an empty name.
 */
export function trimIfString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
