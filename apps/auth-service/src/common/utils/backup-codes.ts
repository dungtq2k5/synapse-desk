/**
 * Two-factor backup codes: minting, formatting and normalising.
 */

import { randomInt } from 'node:crypto';
import {
  BACKUP_CODE_ALPHABET,
  BACKUP_CODE_LENGTH,
} from '../configs/app.config';

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
