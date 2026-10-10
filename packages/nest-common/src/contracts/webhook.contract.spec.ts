import { signWebhook, verifyWebhookSignature } from './webhook.contract';

describe('webhook signing', () => {
  const secret = 'whsec_test';
  const timestamp = 1_788_000_000;
  const body = '{"id":"evt_1","type":"ticket.assigned"}';

  it('a signature verifies against the exact bytes signed', () => {
    // The worked example the customer docs describe, asserted against the real
    // signer rather than kept true by proofreading.
    const signature = signWebhook(secret, timestamp, body);

    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(
      true,
    );
  });

  it('**a changed byte, timestamp or secret fails** — each independently', () => {
    const signature = signWebhook(secret, timestamp, body);

    expect(
      verifyWebhookSignature(secret, timestamp, `${body} `, signature),
    ).toBe(false);
    expect(verifyWebhookSignature(secret, timestamp + 1, body, signature)).toBe(
      false,
    );
    expect(
      verifyWebhookSignature('whsec_other', timestamp, body, signature),
    ).toBe(false);
  });

  it('a malformed hex signature is refused, not thrown on', () => {
    // The receiver controls this string; a length mismatch must be a `false`,
    // never a crash in the verifier.
    expect(verifyWebhookSignature(secret, timestamp, body, 'zzzz')).toBe(false);
  });
});
