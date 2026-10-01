import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  stripQuotedHtml,
  stripQuotedReply,
  toStoredBody,
} from './quoted-reply';

/**
 * The shared table the Java gateway's quoted-reply port is held to.
 *
 * A JavaScript regex and a Java one that read alike are not alike — `^`, `$`,
 * `.` and `\s` cover different characters, and `\r\n` is one terminator to Java
 * and two to JS — so the port spells those out and is checked against ONE table
 * of inputs and answers. Every row is recomputed here from the real functions on
 * every run; in Java the port is checked against the same rows. A table nobody
 * recomputed would agree with whatever was written down.
 */
describe('the quoted-reply parity table', () => {
  const table = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../test/fixtures/inbound-email/quoted-reply-parity.json',
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
