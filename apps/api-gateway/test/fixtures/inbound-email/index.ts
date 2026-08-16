import { createHmac } from 'node:crypto';
import { generateInboundToken } from '@synapsedesk/common';

/**
 * Recorded-shape payloads for the inbound-email webhook
 *
 * **Built here rather than captured, for now.** The doc asks for payloads
 * recorded from a real Worker run, and it is right: a synthetic fixture agrees
 * with whatever the parser does, and a recorded one disagrees, which is the
 * point. The Worker is step 8, so these stand in until there is one to record
 * from — and the shape is the DTO, which is the contract both sides are written
 * against.
 */
export const INBOUND_DOMAIN = 'inbound.test';

export type InboundFixture = ReturnType<typeof plainEmail>;

export function plainEmail(overrides: Record<string, unknown> = {}) {
  return {
    messageId: '<CAF=abc123@mail.example.test>',
    to: `support+${generateInboundToken()}@${INBOUND_DOMAIN}`,
    from: 'customer@acme.test',
    fromName: 'A Customer',
    subject: 'The printer is on fire',
    text: 'It really is. Please help.',
    html: null,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Signs a payload the way the Worker does
 *
 * **Serialise once, sign that, send that.** Signing a re-serialised copy is the
 * Stripe raw-body trap in a new costume: key order or whitespace differs, the
 * digest differs, and every request fails in production while passing here.
 * Returning both the bytes and the signature is what makes that impossible to
 * get wrong at a call site.
 */
export function signPayload(
  payload: unknown,
  secret: string,
): { body: string; signature: string } {
  const body = JSON.stringify(payload);

  return {
    body,
    signature: createHmac('sha256', secret).update(body).digest('hex'),
  };
}
