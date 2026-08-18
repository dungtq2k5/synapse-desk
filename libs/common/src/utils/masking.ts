/** @file Masking for values that must never appear in full pre-auth (conventions §8.3). */

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
