/**
 * @file The tags the rows declare, and the published APIs they exercise.
 *
 * Two rows, and between them they keep "every API has a row" from rotting
 * into a claim nobody can check:
 *
 * - a tag a row DECLARES that names no published API is a typo, and the row
 *   would claim to exercise something that does not exist;
 * - a published API that no row declares is served and never exercised — and
 *   the first row cannot see it, because it only ever proves that the tags
 *   rows DO declare are real.
 *
 * The second is the direction rule: scanning from the rows toward the document
 * proves nothing about the rows that are missing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './gateway';
import { declaredTags, tagsIn } from './pending';

describe('the rows declared tags', () => {
  /**
   * Every tag the published document names, read from the document itself —
   * the file `openapi:check` and `openapi:check:java` both hold the gateways
   * to, so it stays the authority on what the APIs are called.
   */
  const publishedTags = (): Set<string> => {
    const document = JSON.parse(
      readFileSync(join(REPO_ROOT, 'docs/reference/openapi.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, { tags?: string[] }>> };

    const tags = new Set<string>();
    for (const path of Object.values(document.paths)) {
      for (const operation of Object.values(path)) {
        for (const tag of operation.tags ?? []) tags.add(tag);
      }
    }

    return tags;
  };

  it('**every declared tag names a published API** — a typo would claim a row that exercises nothing', () => {
    const published = publishedTags();
    const unknown = declaredTags().filter((tag) => !published.has(tag));

    expect(unknown).toEqual([]);
    // Two floors: an empty universe, or a scan that stopped matching the row
    // helper's calls, would each make the check above vacuous.
    expect(published.size).toBeGreaterThanOrEqual(30);
    expect(declaredTags().length).toBeGreaterThanOrEqual(5);
  });

  it('**every published API is exercised by some row**', () => {
    // The direction that matters: from the document toward the rows. An API
    // served by the gateways that no row declares is one the harness never
    // exercises, on either implementation.
    const declared = new Set(declaredTags());
    const published = publishedTags();

    expect([...published].filter((tag) => !declared.has(tag))).toEqual([]);
    expect(published.size).toBeGreaterThanOrEqual(30);
  });

  it('tagsIn survives a nested call inside the row helper', () => {
    // The highest-consequence of the regex-boundary rows: `declaredTags` is
    // upstream of BOTH tests above, so an under-count here does not fail
    // loudly — it makes them check fewer tags while staying green. A nested
    // call is not real code anywhere today; this pins that if it ever
    // becomes real, the tag it names is still seen.
    //
    // Built from pieces, not a literal open-paren call: `declaredTags` scans
    // this file's own raw TEXT for that exact substring, with no idea it is
    // inside a fixture rather than a real declaration — a literal copy here
    // would add "Nested" and "Plain" to the REAL tag universe and fail the
    // rows above.
    const call = ['row', 'For'].join('');
    const hostile = [
      `${call}(tagsFor('Nested'))('a row inside a helper call', async () => {});`,
      `${call}('Plain')('an ordinary row', async () => {});`,
    ].join('\n');

    expect(tagsIn(hostile)).toEqual(['Nested', 'Plain']);
  });
});
