/**
 * @file Signs a body the way Resend does, independent of the gateway's own
 * verifier — so a signing bug in either gateway cannot be hidden by a test that
 * shares its implementation.
 */

import { createHmac, randomUUID } from 'node:crypto';

/** The three Standard Webhooks headers for `body`, signed with `secret`. */
export function signStandardWebhook(
  body: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
  id = `msg_${randomUUID()}`,
) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestampSeconds}.${body}`)
    .digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': String(timestampSeconds),
    'svix-signature': `v1,${digest}`,
  };
}
