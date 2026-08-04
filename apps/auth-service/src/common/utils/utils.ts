import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { extractEmailDomain } from '@synapsedesk/common';
import {
  AES_ALGORITHM,
  AES_IV_BYTES,
  AES_KEY_BYTES,
  BACKUP_CODE_ALPHABET,
  BACKUP_CODE_LENGTH,
} from '../configs/app.config';

export function generateUniqueOrganizationSlug(email: string): string {
  const domain = extractEmailDomain(email);
  if (!domain) throw new Error('Invalid email domain');

  return domain.replaceAll('.', '-');
}

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

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60 * 1000);
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

// ---------------------------------------------------------------------------
// TOTP secret encryption
// ---------------------------------------------------------------------------

/**
 * The env var is an arbitrary passphrase, so it is stretched to a real 32-byte
 * key rather than being used raw (a 20-character passphrase is not a 256-bit
 * key). The salt is fixed because the derived key must be reproducible across
 * restarts and replicas — the secrecy lives in TWO_FACTOR_MASTER_KEY.
 */
function deriveKey(masterKey: string): Buffer {
  return scryptSync(masterKey, 'synapsedesk.2fa.v1', AES_KEY_BYTES);
}

export function encryptSecret(plaintext: string, masterKey: string): string {
  const iv = randomBytes(AES_IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, deriveKey(masterKey), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decryptSecret(encrypted: string, masterKey: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted secret');
  }

  const decipher = createDecipheriv(
    AES_ALGORITHM,
    deriveKey(masterKey),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// ---------------------------------------------------------------------------
// 2FA backup codes
// ---------------------------------------------------------------------------

/**
 * `randomInt` rather than `Math.random()`: these are credentials, and
 * `Math.random()` is a predictable PRNG. Formatted `XXXXX-XXXXX` purely so a
 * human can transcribe it without losing their place.
 */
export function generateBackupCode(): string {
  let code = '';
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    code += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
  }

  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Generates a set with no duplicates.
 *
 * A duplicate would be a code that stops working after its twin is consumed,
 * which looks exactly like a bug to the user.
 */
export function generateBackupCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateBackupCode());

  return [...codes];
}

/** Case- and format-insensitive: users type these off paper. */
export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replaceAll('-', '');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * A plain `===` leaks how many leading characters matched via its exit time.
 * That is a weak channel, but free to close.
 */
export function safeCompareHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;

  return timingSafeEqual(left, right);
}

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
