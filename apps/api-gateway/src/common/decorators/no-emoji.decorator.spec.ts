import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateDepartmentDto } from '../../modules/departments/dto/rest/department.dto';

/**
 * The emoji rule, and the two ways it is usually got wrong.
 *
 * Both failure modes are silent in the sense that matters: a rule that rejects
 * `田中太郎` and a rule that rejects `Team 2` both look like working validators
 * until somebody with that name or that team hits one.
 */
describe('NoEmoji (unit)', () => {
  const nameErrors = (name: unknown) =>
    validateSync(plainToInstance(CreateDepartmentDto, { name }))
      .map((error) => error.property)
      .filter((property) => property === 'name');

  it('**1. accepts non-Latin names — the test nobody writes**', () => {
    // The only test here that fails when someone "simplifies" the rule to an
    // ASCII range, and every other test in this file still passes when they do.
    //
    // This product ships eight OCR languages and greeting tables in `vi`, `ja`
    // and `zh`. These are names it is built to serve.
    for (const name of ['Nguyễn Văn A', '田中太郎', 'Ünal Öz', 'Σοφία']) {
      expect([name, nameErrors(name)]).toEqual([name, []]);
    }
  });

  it('**2. accepts digits and punctuation — the `\\p{Emoji}` trap**', () => {
    // `Emoji=Yes` covers `0`-`9`, `#` and `*`, because those form keycap
    // sequences. A validator built on `\p{Emoji}` rejects every one of these,
    // and the refusal reads as arbitrary to whoever hits it.
    for (const name of ['Team 2', 'Tier 1 Support', '#tag', 'Ops * Eng']) {
      expect([name, nameErrors(name)]).toEqual([name, []]);
    }
  });

  it('**3. rejects each emoji shape, including the three that dodge a naive check**', () => {
    // One row per branch of the pattern. Drop any single alternation and
    // exactly one of these goes green.
    const CASES: readonly (readonly [string, string])[] = [
      ['plain pictographic', 'Support 🚀'],
      ['ZWJ sequence', 'Family 👨‍👩‍👧'],
      ['regional indicator', 'Team 🇻🇳'],
      // **The two below isolate branches the obvious examples do not.**
      //
      // `👍🏽` and `™️` are the natural illustrations and both are caught by
      // `Extended_Pictographic` alone — 👍 and ™ each carry that property
      // themselves, so the modifier and variation-selector branches never fire.
      // Sabotage proved it: deleting either left all six tests green.
      //
      // A BARE modifier and a digit wearing U+FE0F carry no pictographic
      // property, so each is caught by exactly one branch and nothing else.
      // `Tier 1️⃣` is the realistic form — somebody naming a support tier.
      ['bare skin-tone modifier', 'Palette 🏽'],
      ['keycap via variation selector', 'Tier 1️⃣'],
    ];

    for (const [label, name] of CASES) {
      expect([label, nameErrors(name)]).toEqual([label, ['name']]);
    }
  });

  it('4. leaves a non-string to `@IsString`, rather than reporting emoji', () => {
    // Composition, the same rule `IsFutureDate` and `AtMostOneNonLatinScript`
    // both state: a number is not a name with an emoji in it, and saying so
    // sends the caller looking in the wrong place.
    const errors = validateSync(
      plainToInstance(CreateDepartmentDto, { name: 42 }),
    ).flatMap((error) => Object.keys(error.constraints ?? {}));

    expect(errors).toContain('isString');
    expect(errors).not.toContain('noEmoji');
  });

  describe('**the pattern is what the docblock says it is**', () => {
    /**
     * The cheapest possible guard against the failure this file has already had.
     *
     * `EMOJI_PATTERN` lost its variation-selector branch between one run and the
     * next. Nothing caught it structurally — the branch is a single invisible
     * codepoint when written literally, so its removal left no visible trace in
     * a diff, and only the keycap case going green revealed it.
     *
     * Reading the SOURCE rather than exercising the regex, because the failure
     * mode is the source drifting from the prose that describes it. Behavioural
     * tests already cover what the pattern matches.
     */
    const source = readFileSync(
      join(__dirname, 'no-emoji.decorator.ts'),
      'utf8',
    );

    const pattern =
      /const EMOJI_PATTERN =\s*(\/.+\/u);/.exec(source)?.[1] ?? '';

    it('1. it has the four branches the docblock tabulates', () => {
      expect(pattern).not.toBe('');
      expect(pattern.split('|')).toHaveLength(4);
    });

    it('**2. and U+FE0F is written as an ASCII escape, never as the character**', () => {
      // The whole defect in one assertion. Spelled literally the branch is
      // invisible: a reformat, a lint autofix or a careless paste deletes it
      // with nothing on screen to show what went, and every emoji test still
      // passes except the one keycap case.
      //
      // Asserted on the BYTES, so a literal cannot satisfy it by rendering the
      // same way this comment does.
      expect(pattern).toContain('\\uFE0F');
      expect(
        [...pattern].every((character) => character.charCodeAt(0) < 128),
      ).toBe(true);
    });
  });

  describe('**every name field carries it**', () => {
    /**
     * Derived by scanning, never from a list.
     *
     * The count in doc 53's first draft was thirteen; the tree holds sixteen,
     * and three of the misses were `slug`. A scan asserting a hand-written floor
     * would have passed green with fields unguarded — so the expected set comes
     * from the same walk that finds the offenders.
     */
    const MODULES = join(__dirname, '../../modules');

    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else out.push(path);
      }

      return out;
    };

    /** Comments removed, so prose naming a decorator is not a decorator. */
    const withoutComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    /** Every INPUT DTO field named `name`/`fullName`, with its guard state. */
    const nameFields = () =>
      walk(MODULES)
        .filter(
          (path) =>
            path.endsWith('.dto.ts') && !path.includes('-response.dto.ts'),
        )
        .flatMap((path) => {
          const lines = withoutComments(readFileSync(path, 'utf8')).split('\n');

          return lines.flatMap((line, index) => {
            if (!/^\s+readonly (name|fullName)[?!]?:/.test(line)) return [];

            let top = index;
            while (top > 0 && lines[top - 1].trim().startsWith('@')) top -= 1;
            const decorators = lines.slice(top, index).join('\n');

            return [
              {
                where: `${path.slice(path.lastIndexOf('/') + 1)}:${index + 1}`,
                guarded: decorators.includes('@NoEmoji()'),
              },
            ];
          });
        });

    it('1. the scan finds name fields at all', () => {
      // Guards the guard: an empty walk makes the assertion below pass over
      // nothing, which is the failure this whole describe is about.
      expect(nameFields().length).toBeGreaterThanOrEqual(13);
    });

    it('2. **and none of them is unguarded**', () => {
      expect(
        nameFields()
          .filter(({ guarded }) => !guarded)
          .map(({ where }) => where),
      ).toEqual([]);
    });
  });
});
