import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InboundEmailDto } from './dto/rest/inbound-email.dto';

describe('the mail Worker’s payload contract', () => {
  /**
   * The Worker's payloads satisfy the endpoint's contract.
   *
   * **Both halves are ours**, unlike the Stripe route whose DTO documents
   * somebody else's payload. The Worker cannot import the DTO — it is a Workers
   * runtime outside the workspace — so the agreement is checked against recorded
   * payloads rather than assumed.
   *
   * **These are hand-built, and that is a known weakness.** A synthetic fixture
   * agrees with whatever the parser does; a recorded one can disagree, and the
   * disagreement is the point. Replace them after the first live run.
   */
  const PAYLOADS = join(
    __dirname,
    '../../../test/fixtures/inbound-email/payloads',
  );

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
    // The one shape the guards need, and the one a Worker that
    // forwarded only the body would silently lose.
    const payload = JSON.parse(
      readFileSync(join(PAYLOADS, 'auto-responder.json'), 'utf8'),
    ) as { headers?: Record<string, string> };

    expect(payload.headers).toMatchObject({ 'auto-submitted': 'auto-replied' });
  });
});
