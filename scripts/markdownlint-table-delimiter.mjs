/**
 * @file A markdownlint rule: every table delimiter cell is `:---` or `:---:`.
 *
 * Wired in through `customRules` in `.markdownlint-cli2.jsonc`, so it runs in
 * `npm run lint:md` and `npx markdownlint-cli2 --fix` rewrites what it reports.
 *
 * Two spellings only, and the alignment is kept: a centred column stays
 * centred (`:---:`), and every other column becomes left-aligned (`:---`).
 * The dash count is always three. A right-aligned column (`---:`) is not one of
 * the two, so it is reported and fixed to `:---`.
 *
 * Only the cell's own text is rewritten. The spaces around it belong to MD060
 * (`compact`), so the two rules never edit the same characters.
 */

const LEFT = ':---';
const CENTRED = ':---:';

/** Depth-first over micromark's token tree. */
const walk = (tokens, visit) => {
  for (const token of tokens) {
    visit(token);
    walk(token.children, visit);
  }
};

export default {
  names: ['table-delimiter-style'],
  description: 'Table delimiter cells are `:---` (left) or `:---:` (centred)',
  tags: ['table'],
  parser: 'micromark',
  function: (params, onError) => {
    walk(params.parsers.micromark.tokens, (token) => {
      // micromark only produces this token for a real table, so a pipe-laden
      // line inside a code fence is never visited.
      if (token.type !== 'tableDelimiterRow') return;

      for (const cell of token.children) {
        if (cell.type !== 'tableDelimiter') continue;

        const content = cell.children.find(
          (child) => child.type === 'tableContent',
        );
        if (!content) continue;

        const text = content.text;
        const expected =
          text.startsWith(':') && text.endsWith(':') ? CENTRED : LEFT;

        if (text === expected) continue;

        onError({
          lineNumber: content.startLine,
          detail: `Expected: ${expected}; Actual: ${text}`,
          context: text,
          range: [content.startColumn, text.length],
          fixInfo: {
            editColumn: content.startColumn,
            deleteCount: text.length,
            insertText: expected,
          },
        });
      }
    });
  },
};
