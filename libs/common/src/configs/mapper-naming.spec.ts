import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `to<ReturnTypeName>` — the destination type's name, verbatim.
 *
 * `development-conventions.md` §12 states it and ADR 0004 gives the reason:
 * a mapper names the FOREIGN side, so `toUser` is the shape the rule exists to
 * prevent. What is easy to get wrong is subtler — dropping the `Response` or
 * `Dto` suffix, which reads fine and makes the name stop identifying its own
 * return type.
 *
 * **Scanned from the CODE toward the rule, which is the only direction that
 * finds anything.** Six violations shipped in this repo and every one of them
 * was found by a person happening to open the file: `toSettingsDto` and
 * `toUsageMeterDto` because a nearby change touched them, four more only when
 * somebody finally grepped. A reviewer reading a diff sees the mapper they
 * changed; nothing reads the ones they did not.
 *
 * **Parses the DECLARATION, not a line window.** A regex over `to\\w+Dto` and
 * "the next return type it can see" pairs a function with the following one's
 * signature — an earlier hand-run scan reported `toRefreshResult ->
 * ValidatePasswordResetTokenResponseDto`, which is an artifact of overrunning a
 * boundary rather than a finding. The pattern below anchors on a single
 * `export function` declaration and its own return annotation.
 */
describe('mapper functions name their return type verbatim', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  /**
   * One `function to…(…): ReturnType {` declaration, exported or not.
   *
   * `[\\s\\S]*?` is lazy and bounded by the FIRST `)` that is followed by `:` —
   * so a multi-line parameter list is one match and the next declaration is
   * never absorbed into it.
   *
   * **`export` is OPTIONAL, and requiring it was a scope hole.** The rule is
   * about mapper FILES (§12.1); this pattern was about exported functions in
   * mapper files, and the gap between the two is where `toRevenueDto` lived —
   * a file-local helper in `finance.mapper.ts`, invisible to six runs of this
   * guard and found by somebody reading the file, which is the failure mode the
   * docblock above says this spec exists to end.
   *
   * The carve-out that remains is a `to…` helper inside a SERVICE, and it
   * remains because the corpus below is mapper files — the exemption is the
   * file list, which is where it belongs, rather than a keyword that happened
   * to correlate with it.
   */
  const DECLARATION =
    /(?:export\s+)?function (to[A-Za-z0-9_]*)\s*\((?:(?!function)[\s\S])*?\)\s*:\s*([^{;]+?)\s*\{/g;

  /**
   * Mapper files only.
   *
   * The rule is about `<entity>.mapper.ts` (§12.1). A `to…` helper inside a
   * service is a different animal and its name answers to nothing here.
   */
  const mapperFiles = (): string[] =>
    execFileSync(
      'git',
      [
        'ls-files',
        // **`--cached` alone lists the INDEX**, which is not the source tree.
        // Measured: an unstaged `probe.mapper.ts` carrying a deliberate
        // violation returned zero matches — so every new mapper file was
        // invisible to this guard until somebody `git add`ed it, which is
        // precisely the window in which a mapper is written and named.
        //
        // `finance.mapper.ts` happened to be staged when its violation was
        // found, and that is the only reason the diagnosis landed on `export`.
        // Unstaged, widening the pattern would have changed nothing and the fix
        // would have looked applied.
        '--cached',
        '--others',
        // Still `git` rather than a filesystem walk, for the one thing git is
        // better at here: `.gitignore` already excludes `dist`, `node_modules`
        // and the generated Prisma clients, and a hand-rolled walk would have
        // to re-encode all of it and drift.
        '--exclude-standard',
        '--',
        'apps/**/*.mapper.ts',
        'libs/**/*.mapper.ts',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

  /**
   * The name §12 requires for a given return annotation.
   *
   * Returns `null` when the rule does not resolve — see the generic-wrapper
   * test below.
   */
  const expectedName = (returnType: string): string | null => {
    const type = returnType
      .trim()
      .replace(/^Promise<(.+)>$/s, '$1')
      .trim();

    // `Foo[]` -> `toFoos`. The plural belongs on the type's name, not on a
    // bare `Dtos` suffix — `toSimilarTicketResponseDtos`, never
    // `toSimilarTicketResponseDtos`.
    const array = /^([A-Za-z0-9_]+)\[\]$/.exec(type);
    if (array) return `to${array[1]}s`;

    // A GENERIC wrapper has no single spellable destination name —
    // `PaginationResponseDto<DocumentResponseDto>` cannot be carried verbatim
    // into an identifier. The rule does not resolve; the test below pins the
    // convention that grew in its place instead.
    if (type.includes('<')) return null;

    if (!/^[A-Za-z0-9_]+$/.test(type)) return null;

    return `to${type}`;
  };

  it('**1. every mapper carries its return type verbatim, suffix included**', () => {
    const violations: string[] = [];

    for (const file of mapperFiles()) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');

      for (const [, name, returnType] of source.matchAll(DECLARATION)) {
        const expected = expectedName(returnType);
        if (expected === null || name === expected) continue;

        violations.push(
          `${file}: ${name} returns ${returnType.trim()} — expected ${expected}`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('**2. …and the scan can actually SEE a violation**', () => {
    // The half that stops test 1 passing because the regex matches nothing.
    // A guard that scans zero files is indistinguishable from a clean repo, and
    // this repo has hit that shape before.
    const found = [
      ...`export function toThingDto(x: Wire): ThingResponseDto {`.matchAll(
        DECLARATION,
      ),
    ];

    expect(found).toHaveLength(1);
    expect(expectedName(found[0][2])).toBe('toThingResponseDto');
    expect(found[0][1]).not.toBe('toThingResponseDto');
  });

  it('**3. a multi-line parameter list does not absorb the NEXT declaration**', () => {
    // The artifact that made a hand-run scan unusable: pairing a function with
    // the following one's return type. Two declarations, two matches, each with
    // its own annotation.
    const source = [
      'export function toA(',
      '  wire: WireA,',
      '  extra: Thing,',
      '): AResponseDto {',
      '  return wire;',
      '}',
      '',
      'export function toB(wire: WireB): BResponseDto {',
      '  return wire;',
      '}',
    ].join('\n');

    const matches = [...source.matchAll(DECLARATION)];

    expect(matches.map((m) => m[1])).toEqual(['toA', 'toB']);
    expect(matches.map((m) => m[2].trim())).toEqual([
      'AResponseDto',
      'BResponseDto',
    ]);
  });

  it('**4. a GENERIC wrapper is exempt, and that is a decision rather than a gap**', () => {
    // `PaginationResponseDto<DocumentResponseDto>` has no single name to carry
    // verbatim, so §12's rule does not resolve. Thirteen files answer this the
    // same way — `to<Entity>PageDto` — which makes it a convention in practice.
    //
    // Exempting it is what stops this guard reporting thirteen false positives,
    // and reporting thirteen is how a guard gets switched off.
    expect(
      expectedName('PaginationResponseDto<DocumentResponseDto>'),
    ).toBeNull();
    expect(
      expectedName('Promise<PaginationResponseDto<MessageResponseDto>>'),
    ).toBeNull();
  });

  it('**4b. a NON-EXPORTED declaration is seen**', () => {
    // The first of two scope holes `toRevenueDto` slipped through: a file-local
    // helper in `finance.mapper.ts`, which the rule covers (§12.1 is about
    // mapper FILES) and the pattern did not.
    const found = [
      ...`function toRevenueDto(x: Wire): FinanceRevenueResponseDto {`.matchAll(
        DECLARATION,
      ),
    ];

    expect(found).toHaveLength(1);
    expect(expectedName(found[0][2])).toBe('toFinanceRevenueResponseDto');
    expect(found[0][1]).toBe('toRevenueDto');

    // And the exported form still matches, so widening did not trade one half
    // for the other.
    expect([
      ...`export function toRevenueDto(x: Wire): FinanceRevenueResponseDto {`.matchAll(
        DECLARATION,
      ),
    ]).toHaveLength(1);
  });

  it('**4c. an UNSTAGED mapper file is in the corpus**', () => {
    // The second, wider hole. `git ls-files --cached` lists the INDEX, so a
    // mapper written and not yet `git add`ed was invisible — which is exactly
    // the window in which a mapper is written and named.
    //
    // Written to disk rather than asserted against the flags, because the flags
    // are what is under test: a spec that checked the argv would pass for any
    // combination somebody believed in.
    const probe = join(
      REPO_ROOT,
      'apps/api-gateway/src/modules/platform/unstaged-probe.mapper.ts',
    );

    try {
      writeFileSync(probe, 'export const marker = 1;\n');

      expect(
        mapperFiles().some((file) => file.endsWith('unstaged-probe.mapper.ts')),
      ).toBe(true);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it('**5. the scan reaches real files, not an empty list**', () => {
    // `git ls-files` with a glob that matches nothing returns cleanly, so test 1
    // would pass over zero files and say nothing at all.
    const files = mapperFiles();

    expect(files.length).toBeGreaterThan(10);
    expect(files.every((file) => file.endsWith('.mapper.ts'))).toBe(true);
  });
});
