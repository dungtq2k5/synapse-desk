import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripQuotedHtml, toStoredBody } from './quoted-reply';

/**
 * A randomized corpus the Java HTML stripping is held to, recomputed from the
 * real functions on every run.
 *
 * The hand-written rows in `quoted-reply-parity.json` pin the cases somebody
 * thought of; this holds the Java implementation — written as scanners, not
 * regular expressions, so it is linear — to the same answers on 900 sequences of
 * the tokens the patterns care about (openers that are never closed, tags that
 * almost match, upper and lower case, the case folds that differ between ASCII
 * and Unicode comparison). The corpus is seeded, so it is the same every run, and
 * a mismatch names the input.
 */
describe('the quoted-reply fuzz corpus', () => {
  const rows = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../test/fixtures/inbound-email/quoted-reply-fuzz.json',
      ),
      'utf8',
    ),
  ) as [string, string, string][];

  it('is large enough to mean something, and the patterns really cut in it', () => {
    expect(rows.length).toBeGreaterThanOrEqual(900);
    expect(rows.filter(([html, cut]) => cut !== html).length).toBeGreaterThan(
      200,
    );
  });

  it.each(rows.map((row, index) => [index, ...row] as const))(
    'row %i: the cut and the stored body are what the table says',
    (_index, html, cut, stored) => {
      expect(stripQuotedHtml(html)).toBe(cut);
      expect(toStoredBody(null, html)).toBe(stored);
    },
  );
});
