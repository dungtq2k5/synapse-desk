import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InboundEmailDto } from './dto/rest/inbound-email.dto';

describe('the inbound fixture payloads satisfy InboundEmailDto', () => {
  /**
   * The hand-built fixture payloads are valid `InboundEmailDto`s.
   *
   * **JSON only — this is not a test of the Resend adapter.** The routing e2e
   * suite delivers these fixtures through the real webhook, and a fixture the
   * DTO refuses would turn those tests into `invalid_payload` drops that assert
   * nothing about routing. The mapper from Resend's objects has its own spec,
   * `resend-inbound.mapper.spec.ts`, which is where an adapter regression shows.
   *
   * **Hand-built, and that is a known weakness.** A synthetic fixture agrees
   * with whatever the code does; a recorded one can disagree, and the
   * disagreement is the point. Replace them after the first live capture.
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
    // part" and "the field was forgotten" are different facts. A fixture that
    // omitted them would fail validation on every delivery.
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
    // The one shape the loop guards need, and the one a transport that
    // forwarded only the body would silently lose.
    const payload = JSON.parse(
      readFileSync(join(PAYLOADS, 'auto-responder.json'), 'utf8'),
    ) as { headers?: Record<string, string> };

    expect(payload.headers).toMatchObject({ 'auto-submitted': 'auto-replied' });
  });
});
