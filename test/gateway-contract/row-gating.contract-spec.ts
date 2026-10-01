/**
 * @file That a row named on the skip list is really skipped — `each` rows too.
 *
 * `gate` is what `rowFor` returns for Java, and it is the one place a name on
 * `SKIPPED_FOR_JAVA` becomes a reported skip. Its `each` once came straight from
 * `it`, so a row declared with `each` could not be skipped by name at all and
 * nothing said so: the list simply had no effect on it. These rows drive `gate`
 * against a stand-in for `it` that records what was chosen.
 */

import { gate } from './pending';

/** An `it` that runs nothing and records which variant a row went to. */
function recordingIt() {
  const log: string[] = [];
  const make = (kind: string) => {
    const fn = (title: string) => {
      log.push(`${kind}: ${title}`);
    };
    fn.each = () => (title: string) => {
      log.push(`${kind}.each: ${title}`);
    };

    return fn;
  };
  const base = Object.assign(make('it'), { skip: make('skip') });

  return { base: base as unknown as jest.It, log };
}

describe('gating a row by name', () => {
  const onList = (title: string) => title.includes('PENDING');

  it('sends a named row to skip and any other to it', () => {
    const { base, log } = recordingIt();
    const row = gate(onList, base);

    (row as unknown as (title: string) => void)('a PENDING row');
    (row as unknown as (title: string) => void)('an ordinary row');

    expect(log).toEqual(['skip: a PENDING row', 'it: an ordinary row']);
  });

  it('**gates an `each` row by its template, which is the only name it has**', () => {
    const { base, log } = recordingIt();
    const row = gate(onList, base);

    (row.each([[1]]) as unknown as (title: string) => void)('a PENDING %i row');
    (row.each([[1]]) as unknown as (title: string) => void)(
      'an ordinary %i row',
    );

    expect(log).toEqual([
      'skip.each: a PENDING %i row',
      'it.each: an ordinary %i row',
    ]);
  });
});
