import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isEmail,
  isISO8601,
  isNumberString,
  isPhoneNumber,
  isStrongPassword,
  validateSync,
} from 'class-validator';
import { IsFutureDate } from '../../common/decorators/is-future-date.decorator';

/**
 * A table of inputs and answers for the validators the gateway's DTOs use.
 *
 * `InboundEmailDto` checks `from` with `@IsEmail()` and `receivedAt` with
 * `@IsISO8601({ strict: true })`, and the other columns are the password, phone,
 * numeric-code and lock-date rules. Their answers come from `validator.js` and
 * `libphonenumber`, so a dependency upgrade that changes what a field accepts is
 * a red row here rather than a silent change at the door.
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
        '../../../../../test/fixtures/inbound-email/validator-parity.json',
      ),
      'utf8',
    ),
  ) as {
    email: [string, boolean][];
    iso8601: [string, boolean][];
    strongPassword: [string, boolean][];
    phone: [string, boolean][];
    numeric: [string, boolean][];
    lockDate: [string, boolean][];
  };

  /** The gateway's own decorator, run for real, as `LockUserDto.lockedUntil` runs it. */
  class LockDate {
    @IsFutureDate()
    lockedUntil: string;

    constructor(value: string) {
      this.lockedUntil = value;
    }
  }

  it.each(table.email)('isEmail(%j) is %s', (input, expected) => {
    expect(isEmail(input)).toBe(expected);
  });

  it.each(table.iso8601)('isISO8601(%j, strict) is %s', (input, expected) => {
    expect(isISO8601(input, { strict: true })).toBe(expected);
  });

  it.each(table.strongPassword)(
    'isStrongPassword(%j) is %s',
    (input, expected) => {
      expect(isStrongPassword(input)).toBe(expected);
    },
  );

  it.each(table.phone)('isPhoneNumber(%j) is %s', (input, expected) => {
    expect(isPhoneNumber(input)).toBe(expected);
  });

  it.each(table.numeric)('isNumberString(%j) is %s', (input, expected) => {
    expect(isNumberString(input)).toBe(expected);
  });

  it.each(table.lockDate)(
    'a lock date %j (strict ISO 8601 and in the future) is %s',
    (input, expected) => {
      const future = validateSync(new LockDate(input)).length === 0;

      expect(future && isISO8601(input, { strict: true })).toBe(expected);
    },
  );

  it('**has both polarities for each, and enough rows to mean something**', () => {
    // A table of all-true rows, or a handful, would be satisfied by a validator
    // that accepts everything.
    for (const [rows, floor] of [
      [table.email, 50],
      [table.iso8601, 50],
      [table.lockDate, 50],
      [table.strongPassword, 40],
      [table.phone, 40],
    ] as const) {
      expect(rows.length).toBeGreaterThanOrEqual(floor);
      expect(rows.some(([, accepted]) => accepted)).toBe(true);
      expect(rows.some(([, accepted]) => !accepted)).toBe(true);
    }
    // The OTP-code table is shorter by nature: a number string has few shapes.
    expect(table.numeric.length).toBeGreaterThanOrEqual(20);
    expect(table.numeric.some(([, accepted]) => accepted)).toBe(true);
    expect(table.numeric.some(([, accepted]) => !accepted)).toBe(true);
  });
});
