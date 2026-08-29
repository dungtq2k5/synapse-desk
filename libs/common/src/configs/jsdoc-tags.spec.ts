import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * An `@` in a doc comment is a TAG, whatever it was meant to be.
 *
 * TypeScript's JSDoc scanner starts a block tag at any `@` preceded by
 * whitespace, so a line that begins `@synapsedesk/common` or `@UseGuards(…)`
 * ends the description there and turns everything after it into the body of a
 * tag nobody declared. Measured on the real files, not argued from the spec:
 *
 * - `GRPC_LOADER_OPTIONS` had NO description at all — its docblock opened with
 *   `@grpc/proto-loader`.
 * - `OrgAccessKind`, `RequirePermission` and `EmailVerifiedGuard` each stopped
 *   at the colon introducing the examples, with three, two and one phantom tags
 *   behind them.
 * - Both `LimitAlertGeneration.dimension` columns truncated mid-sentence at
 *   "in", and Prisma copied the broken doc into the generated client.
 *
 * **Invisible in review, and invisible in the diff.** The source reads exactly
 * as intended; only the rendered hover is wrong, and nobody hovers their own
 * code. Six of these shipped before anything looked.
 *
 * The fix is always the same: put a backtick before the `@`, which is correct
 * anyway — a package name or a decorator IS code. Measured alternatives that do
 * NOT work: fenced code blocks, four-space indentation, and moving the `@`
 * mid-line, because the scanner only cares that the character before it is not
 * whitespace.
 */
describe('doc comments do not open accidental JSDoc tags', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  /**
   * Every tag this repo legitimately writes.
   *
   * Derived from the tree rather than from the JSDoc manual: a permissive list
   * would wave through the exact typo this exists to catch. Adding a real tag
   * here is a deliberate edit, which is the point.
   */
  const KNOWN_TAGS = new Set(['file', 'example', 'param', 'returns', 'throws']);

  /**
   * A doc line whose first token is `@something`.
   *
   * Matches `*` and Prisma's `///`, and requires whitespace before the `@` —
   * that whitespace is precisely what makes the scanner treat it as a tag.
   */
  const DOC_TAG = /^\s*(?:\*|\/\/\/)\s+@([A-Za-z][\w-]*)/;

  const documentedFiles = (): string[] =>
    execFileSync(
      'git',
      [
        'ls-files',
        '--',
        'apps/**/*.ts',
        'libs/**/*.ts',
        'apps/**/*.prisma',
        'scripts/*.mjs',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // Generated output carries whatever its source said, so a hit here is a
      // duplicate report of a defect in the schema that produced it.
      .filter((file) => !file.includes('/generated/'));

  const strayTags = (source: string): string[] => {
    const found: string[] = [];

    source.split('\n').forEach((line, index) => {
      const match = DOC_TAG.exec(line);
      if (match && !KNOWN_TAGS.has(match[1])) {
        found.push(`${index + 1}: @${match[1]}`);
      }
    });

    return found;
  };

  it('**1. no doc line opens a tag this repo did not mean**', () => {
    const violations: string[] = [];

    for (const file of documentedFiles()) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');

      for (const hit of strayTags(source)) {
        violations.push(
          `${file}:${hit} — backtick it, or the description ends here`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('**2. …and the scan can actually SEE one**', () => {
    // Guards the guard. Both shapes that shipped: a package name opening a
    // docblock, and a decorator inside an example.
    const source = [
      '/**',
      ' * @grpc/proto-loader options.',
      ' *',
      ' * @example',
      ' *   @UseGuards(JwtAuthGuard)',
      ' */',
    ].join('\n');

    expect(strayTags(source)).toEqual(['2: @grpc', '5: @UseGuards']);
  });

  it('**3. the backticked form is NOT reported**', () => {
    // The fix has to pass, or the guard argues for a change it cannot accept.
    const source = [
      '/**',
      ' * `@grpc/proto-loader` options.',
      ' *',
      ' * @example',
      ' *   `@UseGuards(JwtAuthGuard)`',
      ' * @throws when it cannot load',
      ' */',
    ].join('\n');

    expect(strayTags(source)).toEqual([]);
  });

  it('**4. the scan reaches real files, not an empty list**', () => {
    const files = documentedFiles();

    expect(files.length).toBeGreaterThan(100);
    expect(files.every((file) => !file.includes('/generated/'))).toBe(true);
  });
});
