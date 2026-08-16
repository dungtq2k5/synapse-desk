import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison and HMAC verification for webhook signatures.
 *
 * **Here rather than in a service, because the gateway now needs it**
 * §6.1. `safeCompareHex` lived only in `apps/auth-service/src/common/utils/crypto.ts`,
 * which is where Stripe's signature is checked; the inbound-email route
 * verifies at the EDGE, and a gateway cannot import a service's private
 * utility.
 *
 * **The alternative was writing a second one**, and that is the failure this
 * placement exists to avoid: a re-implemented constant-time compare is
 * reliably a non-constant-time compare, because the obvious spelling — `===`,
 * or `Buffer.compare` on unequal lengths — is the wrong one and looks right.
 */

/**
 * Constant-time comparison of two hex digests.
 *
 * A plain `===` leaks how many leading characters matched via its exit time.
 * That is a weak channel, but free to close.
 *
 * **Length inequality is answered before `timingSafeEqual`**, which throws on
 * mismatched buffers rather than returning false — so the guard is required for
 * correctness, not only for speed. An empty digest is refused too: two empty
 * buffers compare equal, and "no signature" must never verify.
 */
export function safeCompareHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;

  return timingSafeEqual(left, right);
}

/**
 * Verifies an HMAC-SHA256 signature over the EXACT bytes received.
 *
 * **`payload` must be the raw body, never a re-serialised object**
 * §3.2, and the trap is worth restating at the one place both webhooks reach.
 * A JSON parser deserialises and re-serialises: different key order, different
 * whitespace, a different digest, and verification fails for every request
 * forever while passing every local test that builds the body itself.
 *
 * Returns `false` for a malformed signature rather than throwing. A caller
 * answering 401 wants a boolean; an exception here would surface as a 500,
 * which tells the sender to retry a request that can never succeed.
 */
export function verifyHmacSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  return safeCompareHex(signature, expected);
}
