/**
 * @file String shaping: slugs, masking and URL tidying.
 */

import { extractEmailDomain } from '@synapsedesk/common';

export function generateUniqueOrganizationSlug(email: string): string {
  const domain = extractEmailDomain(email);
  if (!domain) throw new Error('Invalid email domain');

  return domain.replaceAll('.', '-');
}

/**
 * Hides most of an address while leaving enough to recognize it:
 * `alice@acme.com` -> `a***e@acme.com`.
 *
 * Used on the password-reset pre-flight so the UI can confirm which account is
 * being reset without the endpoint becoming a way to read addresses out of the
 * database given a stolen token.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';

  const visible =
    local.length <= 2
      ? `${local[0] ?? ''}***`
      : `${local[0]}***${local.at(-1)}`;

  return `${visible}@${domain}`;
}

// ----------------------------------------------------------------  TOTP secret encryption

/**
 * Strips trailing slashes without a regex.
 *
 * `/\/+$/` is the obvious version and a backtracking hazard: on an input of
 * many slashes the engine retries every way of splitting the `+` group. This is
 * linear and needs no reasoning about the regex engine.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;

  return value.slice(0, end);
}
