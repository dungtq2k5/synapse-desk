import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Every directory holding TypeScript is claimed by a typecheck.
 *
 * **Twice in three documents a new top-level directory landed outside the root
 * `tsconfig.json` include** — `scripts/seed-demo` (doc 64: a wrong enum member
 * became `undefined` at runtime and wrote 200 rows with the column default),
 * then `test/system` (1,798 lines no aggregate command compiled). Both fixes
 * were patches: one more path in the list. This is the rule the patches were
 * standing in for — the fourth directory fails here on arrival, not three
 * documents later.
 *
 * `ts-jest` and `tsx` do not close the gap: both transpile per file and
 * typecheck no program, so a green test run says nothing about the types of
 * what it ran.
 */
describe('every TypeScript directory is inside a typecheck', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  /**
   * Directories deliberately OUTSIDE the root program, each with its reason.
   *
   * **Named, never pattern-matched** — the `TWINLESS` / `NON_BROWSER_HEADERS`
   * shape. A scan that is red on arrival gets weakened to green by whoever
   * runs it next, and `workers/` would have made this one red on arrival: it
   * is excluded from the root include AND from eslint on purpose, with the
   * reason recorded in `eslint.config.mjs`.
   */
  const OUTSIDE_ROOT_PROGRAM: Readonly<Record<string, string>> = {
    workers:
      'a Workers runtime, not a Nest app; carries its own tsconfig and is ' +
      'typechecked inside its own directory — eslint.config.mjs records this',
    'jest.config.base.ts':
      "tooling config, excluded by the root tsconfig's own header: jest " +
      'evaluates it as ESM with an explicit .ts import extension, which tsc ' +
      'rejects (TS5097) unless a flag that would break `nest build` is set',
  };

  /**
   * The corpus: tracked and untracked-but-not-ignored `.ts` files.
   *
   * `--cached --others --exclude-standard` is the doc 67 §6 correction applied
   * from the start rather than retrofitted: the index alone misses a directory
   * added and not yet staged, which is precisely when a new one appears. And
   * `git` rather than a filesystem walk because `.gitignore` already excludes
   * `dist`, `node_modules`, `.venv` and the generated clients — a hand-rolled
   * walk would re-encode all of it and drift.
   */
  const sourceFiles = (): string[] =>
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.ts'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // Declaration files describe someone else's program.
      .filter((file) => !file.endsWith('.d.ts'));

  /**
   * Top-level directory of a repo-relative path — or the filename itself for a
   * root-level file, which is what lets `jest.config.base.ts` be exempted by
   * name.
   *
   * **Top-level is also this rule's honest scope.** Both directories that
   * motivated it were NEW top-level trees; a file dodging the globs INSIDE a
   * claimed top — `apps/x/jest.config.ts` sits outside `apps/x/src` and
   * `apps/x/test` — passes here. That is the per-file version of the problem
   * and a different, much noisier rule.
   */
  const topOf = (file: string): string => file.split('/')[0];

  /**
   * The include globs, reduced to the top-level directories they claim.
   *
   * Parsed from the file rather than re-declared, so this test cannot agree
   * with a stale copy of the thing it guards.
   */
  const claimedTops = (): Set<string> => {
    // **TypeScript's own JSONC parser, not a comment-strip.** The first version
    // stripped comments by regex before `JSON.parse` — and the block-comment
    // pattern ate the GLOBS: `"apps/*/src/**/*"` contains `/*` and `*/`, so the
    // include list came back as `apps*` and this test failed every directory at
    // once. A comment-stripper cannot be pointed at a file whose strings
    // contain comment delimiters, and tsconfig globs always do.
    const { config, error } = ts.parseConfigFileTextToJson(
      'tsconfig.json',
      readFileSync(join(REPO_ROOT, 'tsconfig.json'), 'utf8'),
    );

    if (error)
      throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));

    const include = (config as { include: string[] }).include;

    return new Set(include.map((glob) => glob.split('/')[0]));
  };

  it('1. **every top-level directory with `.ts` is claimed or named**', () => {
    const claimed = claimedTops();
    const seen = new Map<string, string>();

    for (const file of sourceFiles()) {
      const top = topOf(file);
      if (!seen.has(top)) seen.set(top, file);
    }

    const unclaimed = [...seen.entries()]
      .filter(([top]) => !claimed.has(top) && !(top in OUTSIDE_ROOT_PROGRAM))
      .map(([top, example]) => `${top}/ (e.g. ${example})`);

    expect(unclaimed).toEqual([]);
  });

  it('2. **the corpus and the include are both populated** — controls', () => {
    // A scan over zero files is indistinguishable from a clean repo, and an
    // include list that failed to parse would claim nothing and fail test 1
    // for every directory at once — this is what tells those two apart.
    const files = sourceFiles();
    const claimed = claimedTops();

    expect(files.length).toBeGreaterThan(500);
    expect(claimed.has('apps')).toBe(true);
    expect(claimed.has('test')).toBe(true);
    // And the pattern finds the two directories that motivated the rule.
    expect(files.some((file) => file.startsWith('scripts/seed-demo/'))).toBe(
      true,
    );
    expect(files.some((file) => file.startsWith('test/system/'))).toBe(true);
  });

  it('3. **every exemption still exists** — the carve-out honesty check', () => {
    // An entry for a directory that no longer holds TypeScript is a hole
    // waiting for a new directory to wander into. `stripe-signature`'s rule:
    // an exemption is a decision somebody wrote down, and a decision about
    // nothing should be deleted.
    const tops = new Set(sourceFiles().map(topOf));

    expect(
      Object.keys(OUTSIDE_ROOT_PROGRAM).filter((top) => !tops.has(top)),
    ).toEqual([]);
  });
});
