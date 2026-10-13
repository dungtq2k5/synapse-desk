import { isStrongPassword } from 'class-validator';
import { PASSWORD_POLICY } from '@synapsedesk/contracts';

/**
 * `PASSWORD_POLICY.symbols` is the set validator.js counts as a symbol. Java's
 * `@StrongPassword` and the web's checklist read the string; Node's gateway and
 * this service run validator.js. Each printable character, and a few beyond
 * ASCII, is tried as the only symbol in an otherwise passing password.
 */
describe('PASSWORD_POLICY', () => {
  it('names exactly the symbols validator.js counts', () => {
    const candidates = [
      ...Array.from({ length: 95 }, (_, index) =>
        String.fromCharCode(32 + index),
      ),
      '£',
      '€',
      '¥',
      '§',
      '·',
    ].filter((character) => !/[A-Za-z0-9]/.test(character));

    const counted = candidates
      .filter((character) =>
        isStrongPassword(`Aaaaaa1${character}`, PASSWORD_POLICY),
      )
      .join('');

    expect([...counted].sort()).toEqual([...PASSWORD_POLICY.symbols].sort());
  });

  it.each([
    ['Aa1!aaaa', true],
    ['Aa1!aaa', false],
    ['aa1!aaaa', false],
    ['AA1!AAAA', false],
    ['Aaa!aaaa', false],
    ['Aa1aaaaa', false],
    ['Aa1€aaaa', false],
  ])('%s → %s', (password, strong) => {
    expect(isStrongPassword(password, PASSWORD_POLICY)).toBe(strong);
  });
});
