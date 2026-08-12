/**
 * Token generation, hashing and constant-time comparison.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * A cryptographically random, URL-safe secret.
 *
 * `base64url` rather than `base64` because these values ride in cookies and
 * reset links, where `+` and `/` need escaping. 32 bytes = 256 bits, which is
 * the entropy assumption that makes `hashToken` below safe.
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Deterministic hash for secrets that must be looked up BY VALUE.
 *
 * Used for refresh tokens, device-trust tokens and password-reset tokens --
 * all stored in `@unique` columns that a randomly-salted bcrypt hash could
 * never be queried against.
 *
 * This is NOT a substitute for bcrypt on passwords. bcrypt is deliberately slow
 * to make guessing a low-entropy human password expensive. These tokens are 256
 * random bits: there is nothing to guess, so a fast hash is the right tool and
 * the only one that supports an indexed lookup.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * **Moved to `libs/common`** — 31-doc §6.1. The inbound-email webhook verifies
 * its signature at the GATEWAY, which cannot import a service's private
 * utility, and a second constant-time compare is reliably a non-constant-time
 * one. Re-exported here so the twenty call sites in this service keep their
 * import.
 */
export { safeCompareHex } from '@synapsedesk/common';

/**
 * A zero-padded numeric OTP.
 *
 * `randomInt` per digit rather than `Math.random()`: this is a credential, and a
 * predictable PRNG makes it guessable regardless of length. Zero-padded so a
 * leading zero is never dropped — `randomInt(0, 1e6)` formatted naively yields
 * "42" one time in ten thousand.
 */
export function generateNumericCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += randomInt(10).toString();

  return code;
}
