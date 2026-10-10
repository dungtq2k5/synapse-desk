import { BadRequestException, HttpException } from '@nestjs/common';
import { formatErrorMsg } from './format-error';

/**
 * The contract 77 call sites depend on and nothing asserted.
 *
 * Written before the duplication inside it was extracted, so the two runs prove
 * the same answers rather than the same shape.
 */
describe('formatErrorMsg', () => {
  describe('HttpException', () => {
    it('1. takes a STRING response verbatim', () => {
      expect(formatErrorMsg(new HttpException('plain', 400))).toBe('plain!');
    });

    it('2. joins an ARRAY `message` — the class-validator shape', () => {
      expect(
        formatErrorMsg(new BadRequestException(['a must be a string', 'b'])),
      ).toBe('a must be a string, b!');
    });

    it('3. takes a string `message` off the response object', () => {
      expect(formatErrorMsg(new BadRequestException('nope'))).toBe('nope!');
    });

    it('4. falls back to `err.message` when `message` is neither', () => {
      const err = new HttpException({ message: { nested: true } }, 400);
      expect(formatErrorMsg(err)).toBe(`${err.message}!`);
    });

    it('5. falls back to `err.message` when the response has no `message`', () => {
      const err = new HttpException({ other: 1 }, 400);
      expect(formatErrorMsg(err)).toBe(`${err.message}!`);
    });
  });

  describe('everything else', () => {
    it('6. a plain Error uses its message', () => {
      expect(formatErrorMsg(new Error('boom'))).toBe('boom!');
    });

    it('7. a bare object with a string `message`', () => {
      expect(formatErrorMsg({ message: 'raw' })).toBe('raw!');
    });

    it('8. a bare object with an ARRAY `message`', () => {
      expect(formatErrorMsg({ message: ['x', 'y'] })).toBe('x, y!');
    });

    it('9. a bare object whose `message` is neither is STRINGIFIED', () => {
      expect(formatErrorMsg({ message: 42 })).toBe('42!');
    });

    it('10. a thrown string', () => {
      expect(formatErrorMsg('just text')).toBe('just text!');
    });

    it('11. anything else takes the caller-supplied fallback', () => {
      expect(formatErrorMsg(undefined, 'fallback')).toBe('fallback!');
      expect(formatErrorMsg(null)).toBe('An unknown error occurred!');
    });
  });

  describe('the single trailing `!`', () => {
    it('12. strips ALL trailing `.`, `!` and `?` before appending one', () => {
      expect(formatErrorMsg(new Error('done.'))).toBe('done!');
      expect(formatErrorMsg(new Error('what?!'))).toBe('what!');
      expect(formatErrorMsg(new Error('wat...!?'))).toBe('wat!');
    });

    it('13. leaves interior punctuation alone', () => {
      expect(formatErrorMsg(new Error('a. b. c'))).toBe('a. b. c!');
    });

    it('14. an all-punctuation message collapses to just `!`', () => {
      expect(formatErrorMsg(new Error('...'))).toBe('!');
    });
  });
});
