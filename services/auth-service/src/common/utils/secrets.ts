/**
 * Reversible encryption for the ONE secret that cannot be hashed.
 *
 * A TOTP secret must be readable to verify a code, so it is encrypted rather
 * than digested — the only place in this service where that is true.
 *
 * `deriveKey` stays PRIVATE to this file: it is the key-derivation step both
 * halves share, and exporting it would invite a third caller to derive a key
 * for something else from the same master secret.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  AES_ALGORITHM,
  AES_IV_BYTES,
  AES_KEY_BYTES,
} from '../configs/app.config';

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
