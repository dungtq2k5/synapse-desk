import { createHmac, randomUUID } from 'node:crypto';

/** The three request headers a Standard Webhooks delivery carries. */
export type StandardWebhookHeaders = {
  'svix-id': string;
  'svix-timestamp': string;
  'svix-signature': string;
};

/**
 * Signs a webhook body the way Resend does — the Standard Webhooks scheme.
 *
 * `v1,` + base64 HMAC-SHA256 over `${id}.${timestamp}.${body}`, keyed by the
 * base64-decoded secret after its `whsec_` prefix.
 *
 * **Written out rather than borrowed from the SDK.** The route verifies with
 * `resend`'s own verifier; signing with that same library would let a test pass
 * because the verifier agrees with itself.
 *
 * **Serialize once, sign that, send that.** `body` is the exact string the
 * request sends; signing a re-serialized copy is the raw-body trap in a new
 * costume.
 *
 * @param timestamp Unix SECONDS; defaults to now. The verifier refuses anything
 * more than five minutes either side, which is what a stale-delivery test sets.
 *
 * @example signStandardWebhook('{"type":"email.received"}', 'whsec_c2VjcmV0') // { 'svix-id': 'msg_…', 'svix-timestamp': '1757930000', 'svix-signature': 'v1,…' }
 */
export function signStandardWebhook(
  body: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
  id = `msg_${randomUUID()}`,
): StandardWebhookHeaders {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${digest}`,
  };
}
