import { EMAIL } from './sign-in';

describe('EMAIL', () => {
  it.each([
    ['maya@acme.test', true],
    ['maya.chen@mail.acme.test', true],
    ['maya.acme.test', false],
    ['maya@acme@test', false],
    ['maya@acme', false],
    ['maya @acme.test', false],
    ['maya@acme..test', false],
    ['maya@acme.test.', false],
    ['maya@.acme.test', false],
  ])('%s: %s', (address, valid) => {
    expect(EMAIL.test(address)).toBe(valid);
  });
});
