/**
 * @file Source with its comments removed, for scans that must not read prose.
 *
 * **Every source scan needs this and two have already diverged on it.** A scan
 * that reads comments finds its own explanation of a rule and reports it as an
 * observance — or a violation — of the rule: the CORS contract check proved the
 * line-comment half load-bearing by measurement (deleting `credentials: true`
 * from `main.ts` passed while the comment above it still named it), and the
 * system harness's `pkill` check failed on its own docblock saying "never
 * `pkill`".
 *
 * **The character class is the part that regressed once already.** The obvious
 * spelling, `/^\s*\/\/.*$/gm`, is quadratic: `\s` matches newlines, so under
 * `m` every line-start expands across the rest of a comment-free input before
 * failing. Measured while fixing the copy that drifted: 15.4ms at 4k blank
 * lines, 61.8ms at 8k, against 0.0ms for this form — and across 346 source
 * files the two differ on 106 of them with zero non-whitespace difference.
 * `[ \t]` is the intent — a line comment's leading indentation — and removes
 * the class entirely.
 */

/**
 * Line and block comments gone; strings and code untouched, except that a line
 * STARTING with a line comment is dropped whole.
 *
 * **Not for files whose STRINGS carry comment delimiters.** A tsconfig's globs
 * are the measured case: `"apps/STAR/src/DOUBLESTAR/STAR"` spelled with real
 * asterisks contains both delimiters, and the block pattern ate the middle of
 * every include entry — parse JSONC with `ts.parseConfigFileTextToJson`
 * instead. Over source code the same hazard is a string literal containing
 * a block-comment closer, which the three scans using this accept knowingly.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}
