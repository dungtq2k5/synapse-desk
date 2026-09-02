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
  // **Line comments FIRST, and the order is load-bearing.** A line comment
  // containing a block-comment OPENER — measured victim: the gateway schema's
  // `// … answers \`/knowledge/*\` with a 500 …` — fed the block pass a `/*`
  // that swallowed the next 38 lines and 14 schema keys. Full-line comments
  // gone first, that opener never reaches the block pass; a `//`-led line
  // INSIDE a real block comment is removed harmlessly, since the still-
  // balanced block goes next. The remaining hazard is the same one already
  // documented: delimiters inside strings, or a trailing (not full-line)
  // comment carrying `/*`.
  return source
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}
