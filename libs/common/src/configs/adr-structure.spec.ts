import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every ADR in `docs/decisions/` follows `docs/decisions/TEMPLATE.md`.
 *
 * The rules are the ones `docs/README.md` states for the directory:
 *
 * - the file is `NNNN-kebab-case-title.md`;
 * - line 1 is `# NNNN — Title`, with the same `NNNN` as the file;
 * - line 2 is blank;
 * - line 3 is the status line — `**Status:** accepted` or `superseded by` a
 *   linked ADR — carrying exactly one of `**Code:**` or `**Rule:**`;
 * - the `##` sections open with the template's sections in order and end with
 *   its last one, with any extra `##` sections in between.
 *
 * **The sections are read from the template, not written here.** Editing
 * `TEMPLATE.md` changes what every ADR must contain; there is no second list
 * to update and no way for the two to disagree.
 */
describe('every ADR follows docs/decisions/TEMPLATE.md', () => {
  const REPO_ROOT = join(__dirname, '../../../..');
  const DECISIONS = join(REPO_ROOT, 'docs/decisions');
  const TEMPLATE = 'TEMPLATE.md';

  const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
  const TITLE = /^# (\d{4}) — \S/;
  const STATUS =
    /^\*\*Status:\*\* (?:accepted|superseded by \[ADR \d{4}\]\(\.\/\d{4}-[a-z0-9-]+\.md\))(?: ·|$)/;

  /**
   * The `##` headings of a document, in order.
   *
   * Lines inside fenced code blocks are skipped: an ADR quoting a shell session
   * or a markdown sample may contain a line that starts with `## ` and is not a
   * section.
   */
  const sections = (source: string): string[] => {
    const found: string[] = [];
    let fenced = false;

    for (const line of source.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (!fenced && line.startsWith('## ')) found.push(line.slice(3).trim());
    }

    return found;
  };

  const requiredSections = (): string[] =>
    sections(readFileSync(join(DECISIONS, TEMPLATE), 'utf8'));

  /**
   * Every way `source` departs from the template, as readable strings.
   *
   * @example
   * violations('0033-redis.md', '# 0034 — x\n...')
   * // ['title number 0034 does not match the file number 0033', ...]
   */
  const violations = (
    file: string,
    source: string,
    required: string[],
  ): string[] => {
    const problems: string[] = [];
    const lines = source.split('\n');

    const name = ADR_FILE.exec(file);
    if (!name) problems.push('file name is not NNNN-kebab-case-title.md');

    const title = TITLE.exec(lines[0] ?? '');
    if (!title) {
      problems.push('line 1 is not "# NNNN — Title"');
    } else if (name && title[1] !== name[1]) {
      problems.push(
        `title number ${title[1]} does not match the file number ${name[1]}`,
      );
    }

    if ((lines[1] ?? '').trim() !== '') problems.push('line 2 is not blank');

    const status = lines[2] ?? '';
    if (!STATUS.test(status)) {
      problems.push(
        'line 3 is not "**Status:** accepted" or "superseded by [ADR NNNN](./NNNN-….md)"',
      );
    }
    const anchors =
      (status.match(/\*\*Code:\*\*/g) ?? []).length +
      (status.match(/\*\*Rule:\*\*/g) ?? []).length;
    if (anchors !== 1) {
      problems.push(
        `line 3 carries ${anchors} of **Code:** / **Rule:**, expected exactly 1`,
      );
    }

    const found = sections(source);
    const opening = required.slice(0, -1);
    const closing = required[required.length - 1];

    opening.forEach((section, index) => {
      if (found[index] !== section) {
        problems.push(
          `section ${index + 1} is "${found[index] ?? '(none)'}", expected "${section}"`,
        );
      }
    });
    if (found.length < required.length || found[found.length - 1] !== closing) {
      problems.push(
        `last section is "${found[found.length - 1] ?? '(none)'}", expected "${closing}"`,
      );
    }

    return problems;
  };

  const markdownFiles = (): string[] =>
    readdirSync(DECISIONS).filter((file) => file.endsWith('.md'));

  it('**1. every ADR follows the template**', () => {
    const required = requiredSections();
    const report: string[] = [];

    for (const file of markdownFiles()) {
      if (file === TEMPLATE) continue;
      const source = readFileSync(join(DECISIONS, file), 'utf8');
      for (const problem of violations(file, source, required)) {
        report.push(`${file}: ${problem}`);
      }
    }

    expect(report).toEqual([]);
  });

  it('**2. the template itself satisfies the rules it sets**', () => {
    const lines = readFileSync(join(DECISIONS, TEMPLATE), 'utf8').split('\n');

    expect(lines[0]).toMatch(/^# NNNN — \S/);
    expect(lines[1]).toBe('');
    expect(lines[2]).toMatch(STATUS);
    expect(lines[2]?.match(/\*\*(Code|Rule):\*\*/g)).toHaveLength(1);
  });

  it('**3. the checker reports each kind of departure**', () => {
    const required = ['Decision', 'Why', 'Consequences'];
    const valid = [
      '# 0099 — A claim',
      '',
      '**Status:** accepted · **Code:** `x.ts`',
      '',
      '## Decision',
      '## Why',
      '## Consequences',
    ];
    const withLines = (changes: Record<number, string>) =>
      valid.map((line, index) => changes[index] ?? line).join('\n');

    const cases: Array<[string, string, string]> = [
      ['0099-a-claim.md', withLines({ 0: '# 0098 — A claim' }), 'title number'],
      ['0099-a-claim.md', withLines({ 0: '# A claim' }), 'line 1'],
      ['0099-a-claim.md', withLines({ 1: 'text' }), 'line 2'],
      [
        '0099-a-claim.md',
        withLines({ 2: '**Status:** draft · **Code:** `x.ts`' }),
        'line 3 is not',
      ],
      [
        '0099-a-claim.md',
        withLines({ 2: '**Status:** accepted' }),
        'carries 0',
      ],
      [
        '0099-a-claim.md',
        withLines({ 2: '**Status:** accepted · **Code:** `x` · **Rule:** y' }),
        'carries 2',
      ],
      [
        '0099-a-claim.md',
        withLines({ 4: '## Why', 5: '## Decision' }),
        'section 1',
      ],
      [
        '0099-a-claim.md',
        withLines({ 5: '## Why every option is worse' }),
        'section 2',
      ],
      ['0099-a-claim.md', withLines({ 6: '## What it costs' }), 'last section'],
      ['0099-A_Claim.md', valid.join('\n'), 'file name'],
    ];

    for (const [file, source, expected] of cases) {
      const problems = violations(file, source, required);
      expect(problems.some((problem) => problem.includes(expected))).toBe(true);
    }
  });

  it('**4. conforming shapes are NOT reported**', () => {
    const required = ['Decision', 'Why', 'Consequences'];
    const source = [
      '# 0099 — A claim',
      '',
      '**Status:** superseded by [ADR 0100](./0100-a-newer-claim.md) · **Rule:** [conventions §7.3](../x.md) · **Follows:** ADR 0042',
      '',
      '## Decision',
      '## Why',
      '### A subsection is free',
      '```md',
      '## a quoted heading inside a fence is not a section',
      '```',
      '## An extra section between Why and Consequences',
      '## Consequences',
    ].join('\n');

    expect(violations('0099-a-claim.md', source, required)).toEqual([]);
  });

  it('**5. the scan reaches the real ADRs and a real template**', () => {
    const adrs = markdownFiles().filter((file) => file !== TEMPLATE);

    // An empty directory or a moved one would make test 1 pass over nothing.
    expect(adrs.length).toBeGreaterThanOrEqual(44);
    expect(adrs).toContain('0001-no-prisma-enums.md');

    // A template that lost its sections would make every ADR "conform" to
    // nothing, or to one heading.
    expect(requiredSections().length).toBeGreaterThanOrEqual(3);
  });
});
