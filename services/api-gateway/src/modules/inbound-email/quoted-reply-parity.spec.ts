import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  stripQuotedHtml,
  stripQuotedReply,
  toStoredBody,
} from './quoted-reply';

/**
 * A table of inputs and answers for the quoted-reply stripping.
 *
 * The patterns turn on characters that are easy to misread — what `^`, `$`, `.`
 * and `\s` cover, and whether `\r\n` is one terminator or two — so the cases are
 * written down once and every row is recomputed from the real functions on every
 * run. A table nobody recomputed would agree with whatever was written down.
 */
describe('the quoted-reply parity table', () => {
  const table = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../test/fixtures/inbound-email/quoted-reply-parity.json',
      ),
      'utf8',
    ),
  ) as {
    reply: [string, string][];
    html: [string, string][];
    stored: [string | null, string | null, string][];
  };

  it.each(table.reply)('stripQuotedReply(%j) is %j', (input, expected) => {
    expect(stripQuotedReply(input)).toBe(expected);
  });

  it.each(table.html)('stripQuotedHtml(%j) is %j', (input, expected) => {
    expect(stripQuotedHtml(input)).toBe(expected);
  });

  it.each(table.stored)(
    'toStoredBody(%j, %j) is %j',
    (text, html, expected) => {
      expect(toStoredBody(text, html)).toBe(expected);
    },
  );
});
