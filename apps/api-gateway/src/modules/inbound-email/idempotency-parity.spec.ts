import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InboundEmailService } from './inbound-email.service';

type Row = {
  messageId: string | null;
  from: string;
  subject: string;
  date: string | null;
  text: string | null;
  html: string | null;
};

/**
 * The shared table the Java gateway's idempotency key is held to.
 *
 * The key is a digest, so any difference in how the two gateways see a string —
 * a lone surrogate, a combining mark, a no-break space — is a different key, and
 * a different key means a redelivery landing on the OTHER gateway during a
 * cutover creates a duplicate ticket instead of being recognised as the same
 * mail. Every row is recomputed here from the real private method on every run;
 * Java is checked against the same rows.
 */
describe('the idempotency-key parity table', () => {
  const table = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../test/fixtures/inbound-email/idempotency-parity.json',
      ),
      'utf8',
    ),
  ) as [Row, string][];

  // `idempotencyKeyFor` reads none of the collaborators.
  const service = new InboundEmailService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  ) as unknown as { idempotencyKeyFor(payload: unknown): string };

  it.each(table)('the key of %j is %s', (row, expected) => {
    const key = service.idempotencyKeyFor({
      ...row,
      messageId: row.messageId ?? undefined,
      date: row.date ?? undefined,
    });

    expect(key).toBe(expected);
  });
});
