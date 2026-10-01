import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEmail, isISO8601 } from 'class-validator';

/**
 * The shared table the Java gateway's validators are held to.
 *
 * `InboundEmailDto` checks `from` with `@IsEmail()` and `receivedAt` with
 * `@IsISO8601({ strict: true })`, and the Java gateway has no equivalent that
 * agrees with them by construction: Jakarta's `@Email` accepts `ada@acme`, which
 * `validator.js` refuses. So the two are ported from the library's own source
 * and held to ONE table of inputs and answers, checked here against the real
 * functions and in Java against the port. If either side moves, one of the two
 * checks goes red.
 *
 * **This spec is what keeps the table honest.** A table of answers that nobody
 * recomputed is a fixture that agrees with whatever was written down; here every
 * row is recomputed from the library on every run.
 */
describe('the validator parity table', () => {
  const table = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../test/fixtures/inbound-email/validator-parity.json',
      ),
      'utf8',
    ),
  ) as {
    email: [string, boolean][];
    iso8601: [string, boolean][];
  };

  it.each(table.email)('isEmail(%j) is %s', (input, expected) => {
    expect(isEmail(input)).toBe(expected);
  });

  it.each(table.iso8601)('isISO8601(%j, strict) is %s', (input, expected) => {
    expect(isISO8601(input, { strict: true })).toBe(expected);
  });

  it('**has both polarities for each, and enough rows to mean something**', () => {
    // A table of all-true rows, or a handful, would be satisfied by a validator
    // that accepts everything.
    for (const rows of [table.email, table.iso8601]) {
      expect(rows.length).toBeGreaterThanOrEqual(50);
      expect(rows.some(([, accepted]) => accepted)).toBe(true);
      expect(rows.some(([, accepted]) => !accepted)).toBe(true);
    }
  });
});
