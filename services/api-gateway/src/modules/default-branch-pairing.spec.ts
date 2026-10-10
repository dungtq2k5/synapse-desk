import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A default is only a DEFAULT once the downstream branch is deleted.
 *
 * §5.2's argument for replacing a `?` with a default is that *"a `?` costs
 * every layer below a branch on `undefined`"*. Adding the default while
 * `dto.field ?? fallback` survives in the mapper gets the ceremony and none of
 * the benefit: the value is now supplied twice, and nothing says which one is
 * doing the work.
 *
 * **This has to be a scan, because no runtime test can see it.** Measured: with
 * the DTO default removed AND the mapper branch restored, every assertion about
 * the wire message still passes — both arrangements put the same bytes on the
 * wire. The difference is structural, so the check is too.
 *
 * The exception the rule needs is `clearStripeProductId`, and it is not an
 * exception to this file: its DTO field carries NO default, precisely because
 * one there would clear the column on every unrelated PATCH. The absent case is
 * resolved at the mapper because it must not be resolved at the DTO — so the
 * pair never both exists, and this scan has nothing to say about it.
 */
describe('DTO defaults and mapper branches do not coexist', () => {
  const MODULES = join(__dirname);

  const filesEndingIn = (suffix: string): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(suffix)) out.push(path);
      }
    };
    walk(MODULES);

    return out;
  };

  /** `readonly foo: Bar = baz` — a field that supplies its own value. */
  const DECLARES_DEFAULT = /readonly (\w+)\s*[?!]?\s*:\s*[^=;]+=\s*/g;

  /** `dto.foo ??` — a caller still branching on that same field being absent. */
  const BRANCHES_ON_ABSENCE = /\b(?:dto|query|input)\.(\w+)\s*\?\?/;

  const fieldsWithDefaults = (): Set<string> => {
    const names = new Set<string>();
    for (const file of filesEndingIn('.dto.ts')) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(DECLARES_DEFAULT)) {
        names.add(match[1]);
      }
    }

    return names;
  };

  it('1. **the scan reads a real corpus**', () => {
    // The vacuity guard, and it earns its place here more than usual: test 2
    // passes by finding NOTHING, which is exactly what a broken path also
    // produces.
    const dtos = filesEndingIn('.dto.ts');
    const mappers = filesEndingIn('.mapper.ts');

    expect(dtos.length).toBeGreaterThan(10);
    expect(mappers.length).toBeGreaterThan(10);
    expect(fieldsWithDefaults().size).toBeGreaterThan(15);
  });

  it('2. **the patterns fire on the shape they are written for**', () => {
    // Without this, test 3 is one bad regex away from decorative — the same
    // vacuity as an empty corpus wearing different clothes.
    const declares = [
      ...'  readonly prices: CreatePlanPriceDto[] = [];'.matchAll(
        DECLARES_DEFAULT,
      ),
    ];
    expect(declares.map((match) => match[1])).toEqual(['prices']);

    expect(
      BRANCHES_ON_ABSENCE.exec(
        '    prices: (dto.prices ?? []).map((p) => ({',
      )?.[1],
    ).toBe('prices');
    expect(
      BRANCHES_ON_ABSENCE.exec(
        '    includeDeleted: query.includeDeleted ?? false,',
      )?.[1],
    ).toBe('includeDeleted');
    // …and NOT on the guarded form that replaced them.
    expect(
      BRANCHES_ON_ABSENCE.test('    prices: dto.prices.map((p) => ({'),
    ).toBe(false);
  });

  it('3. **no mapper branches on a field its DTO already defaults**', () => {
    const defaulted = fieldsWithDefaults();
    const offenders: string[] = [];

    for (const file of filesEndingIn('.mapper.ts')) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const field = BRANCHES_ON_ABSENCE.exec(line)?.[1];
        if (field && defaulted.has(field)) {
          offenders.push(
            `${file.slice(MODULES.length + 1)}:${index + 1} — ${line.trim()}`,
          );
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
