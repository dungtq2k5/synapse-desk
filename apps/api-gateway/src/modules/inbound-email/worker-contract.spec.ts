import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InboundEmailDto } from './dto/rest/inbound-email.dto';

/**
 * The Worker's payloads satisfy the endpoint's contract — 32-doc §3.1, §7.
 *
 * **Both halves of this contract are ours**, which is the difference from the
 * Stripe route: that DTO documents somebody else's payload, and this one *is*
 * the agreement between `workers/email-inbound/` and the endpoint. The Worker
 * cannot import the DTO — it is a Workers runtime outside the workspace — so
 * the agreement is checked against recorded payloads instead of assumed.
 *
 * **These are hand-built and that is a known weakness**, stated rather than
 * hidden: 32-doc §7 asks for payloads captured from a real Worker run, because
 * a synthetic fixture agrees with whatever the parser does while a recorded one
 * disagrees — and the disagreement is the point. Replace them after the first
 * live run; the shapes here are what `buildPayload` is written to produce.
 */
const PAYLOADS = join(
  __dirname,
  '../../../test/fixtures/inbound-email/payloads',
);

describe('the mail Worker’s payload contract', () => {
  const fixtures = readdirSync(PAYLOADS).filter((name) =>
    name.endsWith('.json'),
  );

  it('the fixture directory is not empty', () => {
    // Guards the guard: `it.each([])` passes silently, so an empty or moved
    // directory would report a perfectly satisfied contract.
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixtures)('%s validates against InboundEmailDto', (name) => {
    const payload: unknown = JSON.parse(
      readFileSync(join(PAYLOADS, name), 'utf8'),
    );

    const errors = validateSync(
      plainToInstance(InboundEmailDto, payload, {
        enableImplicitConversion: true,
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    // Named in the assertion so a failure says WHICH field, rather than
    // "expected 0, received 1" across six files.
    expect(errors.map((error) => error.property)).toEqual([]);
  });

  it('**every fixture carries `text` and `html` as KEYS**', () => {
    // The DTO requires both present and allows both null, because "no text
    // part" and "the field was forgotten" are different facts. A Worker that
    // omitted them would 400 on every message — and this is the assertion that
    // says so before a live MX record does.
    for (const name of fixtures) {
      const payload = JSON.parse(
        readFileSync(join(PAYLOADS, name), 'utf8'),
      ) as Record<string, unknown>;

      expect([name, 'text' in payload, 'html' in payload]).toEqual([
        name,
        true,
        true,
      ]);
    }
  });

  it('and the auto-responder fixture carries the loop headers', () => {
    // The one shape the guards in 32-doc §5 need, and the one a Worker that
    // forwarded only the body would silently lose.
    const payload = JSON.parse(
      readFileSync(join(PAYLOADS, 'auto-responder.json'), 'utf8'),
    ) as { headers?: Record<string, string> };

    expect(payload.headers).toMatchObject({ 'auto-submitted': 'auto-replied' });
  });
});
