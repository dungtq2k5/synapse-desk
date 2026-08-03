import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sign } from 'jsonwebtoken';
import type { JwtPayload, TwoFactorJwtPayload } from '@synapsedesk/common';

/**
 * Resolved from `__dirname`, not from cwd.
 *
 * The suite is launched from the repo root (`npm run test:e2e`), so a relative
 * `test/fixtures/...` would resolve to a path that does not exist. Anchoring to
 * this file keeps the helper working from any cwd — which matters the first
 * time somebody runs a single spec from inside `apps/api-gateway`.
 */
const KEY_DIR = join(__dirname, '..', 'fixtures', 'keys');

/**
 * The PRIVATE halves of the test-only keypair.
 *
 * The gateway itself never holds signing material of any kind — it verifies and
 * never mints. That asymmetry is the whole security model, so the private keys
 * live only here, in the test process, and the public halves that `.env.test`
 * points the gateway at are their counterparts.
 */
const ACCESS_PRIVATE_KEY = readFileSync(
  join(KEY_DIR, 'jwt-access.test.key'),
  'utf8',
);
const TWO_FA_PRIVATE_KEY = readFileSync(
  join(KEY_DIR, 'jwt-2fa.test.key'),
  'utf8',
);

/** A fully authenticated caller's access token. */
export function signAccessToken(
  payload: JwtPayload,
  expiresIn = '15m',
): string {
  return sign(payload, ACCESS_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn,
  } as never);
}

/**
 * A 2FA CHALLENGE token — a caller who has passed the password and nothing
 * else. Signed with the separate 2FA key precisely so it cannot satisfy a route
 * that expects a full session.
 */
export function signTwoFactorToken(
  payload: TwoFactorJwtPayload,
  expiresIn = '5m',
): string {
  return sign(payload, TWO_FA_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn,
  } as never);
}

/**
 * A token signed with the WRONG key.
 *
 * Used to prove the gateway rejects on signature rather than merely on shape —
 * an assertion that is worthless without a token that is structurally perfect
 * and cryptographically invalid.
 */
export function signWithWrongKey(payload: object): string {
  return sign(payload, TWO_FA_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '15m',
  } as never);
}
