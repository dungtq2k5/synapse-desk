import { stripComments } from './strip-comments';

/**
 * The behaviour three source scans now share.
 *
 * Pinned functionally rather than by regex source, because the one regression
 * that actually happened — `[ \t]` widened back to `\s` — changes no output on
 * well-formed source and only its RUNTIME. What CAN be pinned is the contract
 * the scans rely on, and the two hazards the docblock names.
 */
describe('stripComments', () => {
  it('1. strips an INDENTED line comment — the case the regression kept', () => {
    // `\s*` and `[ \t]*` agree here; the test exists so a "simplification" to
    // a start-of-line-only match cannot quietly stop stripping indented prose,
    // which is where every docblock-adjacent `//` lives.
    expect(stripComments('  const a = 1;\n    // pkill lives here\n')).toBe(
      '  const a = 1;\n\n',
    );
  });

  it('2. strips a block comment and keeps the code around it', () => {
    expect(stripComments('before /* pkill */ after')).toBe('before  after');
  });

  it('3. **keeps a line-comment marker mid-line** — the scans depend on it', () => {
    // Only a line STARTING with `//` is dropped. A URL in code survives, which
    // is why the scans can read `https://` without losing the statement.
    const source = "const url = 'https://example.test';\n";

    expect(stripComments(source)).toBe(source);
  });

  it('4. **the glob hazard is real** — this is why tsconfig must not come here', () => {
    // Not a defect being tolerated: a documented boundary being demonstrated.
    // The include glob carries both block delimiters inside a STRING, and the
    // stripper eats everything between them — measured first as
    // `typecheck-coverage.spec.ts` failing every directory at once.
    expect(stripComments('"apps/*/src/**/*"')).not.toContain('src');
  });

  it('5. **a block-comment OPENER inside a line comment opens nothing**', () => {
    // The measured regression: the gateway schema's
    // `// … answers \`/knowledge/*\` with a 500 …` fed the block pass a `/*`
    // that swallowed the next 38 lines and 14 schema keys — silently, because
    // the env-contract scan's floor was the only thing positioned to notice.
    // Line comments are stripped FIRST so the opener never reaches the block
    // pass; this pin is what keeps the two passes in that order.
    const source =
      '  // answers `/knowledge/*` with a 500\n' +
      '  KEY_ONE: 1,\n' +
      '  /** real block */\n' +
      '  KEY_TWO: 2,\n';

    const stripped = stripComments(source);

    expect(stripped).toContain('KEY_ONE');
    expect(stripped).toContain('KEY_TWO');
    expect(stripped).not.toContain('real block');
  });
});
