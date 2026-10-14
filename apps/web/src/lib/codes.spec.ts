/**
 * @jest-environment node
 */
import { countdown, maskEmail, maskedLabel, wrongCode } from './codes';
import { passwordNeeds } from './password-rules';

describe('codes', () => {
  it('masks an address as auth-service does', () => {
    expect(maskEmail('maya@northwind.health')).toBe('m***a@northwind.health');
    expect(maskEmail('jo@acme.example')).toBe('j***@acme.example');
    expect(maskEmail('nope')).toBe('***');
  });

  it('reads a masked address or number out in words', () => {
    expect(maskedLabel('m***a@northwind.health')).toBe(
      'an address starting with m and ending in a, at northwind.health',
    );
    expect(maskedLabel('j***@acme.example')).toBe(
      'an address starting with j, at acme.example',
    );
    expect(maskedLabel('+44******1234')).toBe('a number ending in 1234');
  });

  it('counts down as m:ss', () => {
    expect(countdown(45)).toBe('0:45');
    expect(countdown(480)).toBe('8:00');
    expect(countdown(59.2)).toBe('1:00');
    expect(countdown(-3)).toBe('0:00');
  });

  it('says how many attempts are left, in the singular for one', () => {
    expect(wrongCode(3)).toBe('That code is wrong. You have 3 attempts left.');
    expect(wrongCode(1)).toBe('That code is wrong. You have 1 attempt left.');
  });
});

describe('passwordNeeds', () => {
  it('names the unmet rules in a sentence, or nothing when all are met', () => {
    expect(passwordNeeds('Correct-Horse1')).toBeNull();
    expect(passwordNeeds('abcdefg1')).toBe(
      'Your password needs an uppercase letter and a symbol.',
    );
    expect(passwordNeeds('Abcdefgh!')).toBe('Your password needs a number.');
    expect(passwordNeeds('')).toBe(
      'Your password needs at least 8 characters, a lowercase letter, an uppercase letter, a number and a symbol.',
    );
  });
});
