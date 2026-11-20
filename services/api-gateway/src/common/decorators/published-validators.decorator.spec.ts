import { readFileSync } from 'node:fs';
import { PASSWORD_POLICY } from '@synapsedesk/contracts';
import { isNumberString, isStrongPassword } from 'class-validator';
import {
  ISO8601_PATTERN,
  NUMBER_STRING_PATTERN,
  PASSWORD_PATTERN,
} from './published-validators.decorator';

/** Each published pattern answers as the validator it publishes. */
describe('the published patterns', () => {
  it('**the password pattern accepts exactly what `@IsStrongPassword(PASSWORD_POLICY)` does**', () => {
    const pattern = new RegExp(PASSWORD_PATTERN);
    const samples = [
      'Aa1!aaaa',
      'Aa1!aaa',
      'aa1!aaaa',
      'AA1!AAAA',
      'Aaa!aaaa',
      'Aa1aaaaa',
      'Aa1€aaaa',
      'Correct-Horse1',
      'Aa1 aaaa',
      'Aa1\\aaaa',
      'Aa1]aaaa',
      'Aa1-aaaa',
    ];

    for (const sample of samples) {
      expect([sample, pattern.test(sample)]).toEqual([
        sample,
        isStrongPassword(sample, PASSWORD_POLICY),
      ]);
    }
  });

  it("**the ISO 8601 pattern is validator.js's own expression**", () => {
    const source = readFileSync(
      require.resolve('validator/lib/isISO8601'),
      'utf8',
    );

    expect(/var iso8601 = \/(.+)\/;/.exec(source)?.[1]).toBe(ISO8601_PATTERN);
  });

  it('**the number-string pattern accepts exactly what `@IsNumberString()` does**', () => {
    const pattern = new RegExp(NUMBER_STRING_PATTERN);
    for (const sample of [
      '123456',
      '-1',
      '+2.5',
      '.5',
      '1.',
      'abc',
      '',
      '1e3',
    ]) {
      expect([sample, pattern.test(sample)]).toEqual([
        sample,
        isNumberString(sample),
      ]);
    }
  });
});
