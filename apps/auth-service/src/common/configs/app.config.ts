/**
 * `users.two_factor_secret` is a shared secret, not a password: the server must
 * be able to READ it back to verify a code, so it cannot be hashed. It is
 * therefore encrypted at rest, so a leaked database dump alone does not let an
 * attacker generate valid TOTP codes for every account.
 *
 * AES-256-GCM is authenticated encryption — tampering with the ciphertext makes
 * decryption fail rather than silently yielding garbage.
 *
 * Stored as `iv:authTag:ciphertext`, all hex.
 */
export const AES_ALGORITHM = 'aes-256-gcm';
export const AES_IV_BYTES = 12; // 96 bits, the size GCM is specified for
export const AES_KEY_BYTES = 32;

/** Crockford-ish alphabet: no O/0, I/1 or U, so codes survive being read aloud
 * or copied off a printout. */
export const BACKUP_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';
export const BACKUP_CODE_LENGTH = 10;

/** DI token for the NATS client proxy used to reach notification-service. */
export const NATS_CLIENT = Symbol('NATS_CLIENT');
