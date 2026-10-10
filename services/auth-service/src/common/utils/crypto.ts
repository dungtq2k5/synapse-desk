/**
 * @file Token generation, hashing and constant-time comparison.
 */

import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

import { safeCompareHex } from '@synapsedesk/common';

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
 *
 * That entropy argument does NOT extend to codes a human types -- a 6-digit OTP
 * or a backup code. Those are fetched by (user, purpose) and compared, never
 * looked up by hash, so they use `hashCode`/`verifyCode` below instead.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * **Moved to `libs/common`**. The inbound-email webhook verifies
 * its signature at the GATEWAY, which cannot import a service's private
 * utility, and a second constant-time compare is reliably a non-constant-time
 * one. Re-exported here so the twenty call sites in this service keep their
 * import.
 */
export { safeCompareHex };

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

/**
 * `scrypt` as a promise.
 *
 * Hand-written rather than `promisify(scrypt)`: promisify resolves to the
 * three-argument overload and drops the options parameter, which is the only
 * way to set `N`.
 */
function deriveKey(
  code: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(code, salt, keylen, options, (error, derivedKey) =>
      error ? reject(error) : resolve(derivedKey),
    );
  });
}

const CODE_HASH_PREFIX = 'scrypt';
const CODE_HASH_SALT_BYTES = 16;

/**
 * scrypt cost for a code a human can type. Measured at ~33 ms per hash.
 *
 * `N` is 2^14 and NOT 2^15 for a reason that is not "2^15 felt slow": Node's
 * `scrypt` refuses outright when `128 * N * r` exceeds its default `maxmem` of
 * 32 MiB, and `128 * 2^15 * 8` is EXACTLY 32 MiB. Doubling `N` here does not
 * buy a slower hash, it buys `memory limit exceeded` on every call. Raising it
 * means passing an explicit `maxmem` as well.
 *
 * Deliberately a constant rather than an env knob, unlike `BCRYPT_ROUNDS`. The
 * cost IS the security bound here, and a knob that can be set to a cheap value
 * is one that eventually ships set to a cheap value. If the suite ever needs
 * relief, the lever is a `NODE_ENV === 'test'` override in this file -- never
 * an environment variable a production deploy could get wrong.
 */
export const CODE_HASH_PARAMS = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;

/**
 * Salted, slow hash for a code a human can type -- an OTP or a backup code.
 *
 * Unlike `hashToken`, the output is NOT queryable: every call salts randomly, so
 * two hashes of one code differ. Both call sites already fetch the candidate
 * rows first (by user and purpose, or by user and liveness) and then compare, so
 * nothing is lost. What is gained is that a leaked table no longer surrenders a
 * 20-bit OTP to a dictionary in microseconds.
 *
 * The parameters ride in the returned string -- the same reason bcrypt's string
 * carries its cost -- so a future change verifies old rows with THEIR parameters
 * while hashing new ones with the new. ~80 characters, inside `VarChar(255)`.
 *
 * @example
 * await hashCode('123456');
 * // 'scrypt$N=16384,r=8,p=1$mHhP...$Qk9d...'
 */
export async function hashCode(code: string): Promise<string> {
  const { N, r, p, keylen } = CODE_HASH_PARAMS;
  const salt = randomBytes(CODE_HASH_SALT_BYTES);
  const key = await deriveKey(code, salt, keylen, { N, r, p });

  return [
    CODE_HASH_PREFIX,
    `N=${N},r=${r},p=${p}`,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Verifies a typed code against a stored hash of EITHER format.
 *
 * Legacy `code_hash` rows are 64 hex characters of SHA-256 and carry no `$`; a
 * scrypt row is `scrypt$...`. Backup codes issued before the switch stay on
 * paper for `BACKUP_CODE_TTL_DAYS`, so the legacy arm is load-bearing until they
 * expire -- a hash cannot be re-derived and a code is single-use, so there is no
 * "upgrade on successful verify" to be had.
 *
 * Anything else -- a stub, a truncated value, an empty string -- is no match and
 * never an exception. This runs on a request path where a throw reads to the
 * caller as a server error on what was only a bad code.
 *
 * @example
 * await verifyCode('123456', otp.codeHash); // true | false
 */
export async function verifyCode(
  code: string,
  stored: string,
): Promise<boolean> {
  if (!stored) return false;

  if (!stored.startsWith(`${CODE_HASH_PREFIX}$`)) {
    // The only other format this column has ever held.
    return /^[0-9a-f]{64}$/.test(stored)
      ? safeCompareHex(stored, hashToken(code))
      : false;
  }

  const [, params, saltPart, keyPart] = stored.split('$');
  if (!params || !saltPart || !keyPart) return false;

  const parsed = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(params);
  if (!parsed) return false;

  const [, N, r, p] = parsed.map(Number);
  const salt = Buffer.from(saltPart, 'base64url');
  const expected = Buffer.from(keyPart, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    // Derived with the STORED parameters, not the current ones, so a later
    // change to `CODE_HASH_PARAMS` does not silently invalidate every row.
    actual = await deriveKey(code, salt, expected.length, { N, r, p });
  } catch {
    // Unusable parameters in the stored string (a cost past `maxmem`, a zero).
    return false;
  }

  return timingSafeEqual(actual, expected);
}
