import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No tracked file cites `docs/archive`.
 *
 * The archive is git-ignored — `.gitignore` line 4 — so a citation of it is a
 * pointer to something that does not exist for anyone but the author, and
 * cannot be checked by anyone at all. It is also the one class of reference
 * that ages invisibly: the tree moves on, the archived plan does not, and
 * nothing goes red.
 *
 * **Written after a sweep of 52 of them across 42 files.** Every one had a
 * durable target available at the time it was written — an ADR, a section of
 * `development-conventions.md`, the guard spec that enforces the rule, or the
 * measurement itself, which never needed the attribution. The citations were
 * not load-bearing; they were the nearest thing to hand while the plan was
 * still open in another window.
 *
 * `env-contract.spec.ts` already held this rule for `apps/star/.env*`. This is
 * the same rule with the corpus it should always have had, and that one stays:
 * it carries an env-file floor this cannot express.
 */
describe('nothing tracked cites the archive', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  /**
   * The two shapes an archive reference takes.
   *
   * `doc 56`, `Doc 72 §A`, `docs 68–71` — the citation form, which is what
   * almost every instance was; and the path itself, for a comment that spells
   * the file out. Both are matched case-insensitively on the word, because
   * `Doc` at the start of a sentence was as common as `doc` mid-sentence.
   */
  const CITATION = /\b[Dd]ocs?\s+\d+/;
  const ARCHIVE_PATH = /docs\/archive/;

  /**
   * The citation form when prettier has WRAPPED it.
   *
   * **A line scan cannot see `… the exact class doc` / ` * 70 closed …`,** and
   * that is not hypothetical: `generate-docker-env.mjs` carried exactly this
   * and survived the sweep this guard was written to finish. `\s` in
   * `CITATION` spans a newline happily — what defeats it is the ` * ` comment
   * leader that starts the next line, which is neither whitespace nor a digit.
   *
   * Only the CITATION form can wrap. Prettier never breaks inside a word, so
   * `docs/archive` is always intact on one line; `doc` and `70` are two words
   * and a break between them is ordinary.
   */
  const WRAPPED_HEAD = /\b[Dd]ocs?\s*$/;
  const COMMENT_LEADER = /^\s*(?:\*|\/\/|#)\s*/;

  /**
   * Files that may carry the strings, each for a stated reason.
   *
   * A whole-file exemption rather than a line-level one, because both entries
   * are guards that must SPELL the pattern to detect it — and a guard that
   * cannot name what it looks for is not a guard. An exemption needs a reason
   * beside it, for the same reason `generate-k8s-config.mjs`'s `EXCLUDED` map
   * does: an absent file and a forgotten one are the same diff.
   */
  const EXEMPT = new Map([
    [
      'libs/common/src/configs/archive-references.spec.ts',
      'this file — it holds the patterns',
    ],
    [
      'libs/common/src/configs/env-contract.spec.ts',
      'the narrower env-file version of this rule, which also spells the pattern',
    ],
  ]);

  const corpus = (): string[] =>
    execFileSync(
      'git',
      [
        'ls-files',
        // Untracked-but-not-ignored too: a file written and not yet staged is
        // exactly where a fresh citation lives, and the index alone would read
        // it as clean. `--exclude-standard` is also what keeps `docs/archive`
        // itself out — it is ignored, so it is never a candidate.
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'apps',
        'libs',
        'scripts',
        'test',
        'docs',
        'k8s',
        'docker',
        '.github',
        // Root-level markdown, which is otherwise in none of the directories
        // above and is the most externally-visible text in the repository:
        // `README.md` is what a reader outside this project sees FIRST, so an
        // archive citation there is the one instance that reaches an audience
        // who could never resolve it. Git de-duplicates overlapping pathspecs,
        // so `docs/*.md` is listed once, not twice — verified, not assumed.
        '*.md',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // Generated output carries whatever its source said, so a hit here is a
      // duplicate report of a citation in the `.proto` or `.prisma` that
      // produced it — and `npm run proto:generate` is what clears it.
      .filter((file) => !/\/(generated|dist)\//.test(file))
      .filter((file) => !EXEMPT.has(file));

  const citations = (source: string): string[] => {
    const found: string[] = [];

    const lines = source.split('\n');

    lines.forEach((line, index) => {
      if (CITATION.test(line) || ARCHIVE_PATH.test(line)) {
        found.push(`${index + 1}: ${line.trim()}`);
        return;
      }

      // The wrap case, tested only after the whole-line case has MISSED — so a
      // citation sitting entirely on the next line is reported once, at the
      // line it is on, rather than twice.
      const next = (lines[index + 1] ?? '').replace(COMMENT_LEADER, '');

      if (WRAPPED_HEAD.test(line) && /^\d/.test(next)) {
        found.push(`${index + 1}: ${line.trim()} ⏎ ${next.slice(0, 40)}`);
      }
    });

    return found;
  };

  it('**1. no tracked file points at a plan nobody else can open**', () => {
    const violations: string[] = [];

    for (const file of corpus()) {
      let source: string;
      try {
        source = readFileSync(join(REPO_ROOT, file), 'utf8');
      } catch {
        // A binary or unreadable path is not a citation site.
        continue;
      }

      for (const hit of citations(source)) {
        violations.push(`${file}:${hit}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('**2. …and the scan can actually SEE one**', () => {
    // Guards the guard, with the real shapes: a bare citation, a sectioned
    // one, an en-dashed range, and the path spelled out.
    const source = [
      '// The rule doc 70 measured.',
      ' * Doc 56 §A, and all three clauses matter.',
      '// Corpus discipline as established by docs 68-71.',
      '// See docs/archive/implementations/73-kubernetes.md.',
    ].join('\n');

    expect(citations(source)).toHaveLength(4);
  });

  it('**2b. …including one prettier has wrapped**', () => {
    // The shape that got through the first sweep, verbatim from
    // `generate-docker-env.mjs`.
    const wrapped = [
      ' * could drift from the schema with no test going red — the exact class doc',
      ' * 70 closed for the first two files. Generation closes the class instead of',
    ].join('\n');

    expect(citations(wrapped)).toHaveLength(1);
    expect(citations(wrapped)[0]).toMatch(/^1: /);

    // And a wrap that is NOT a citation stays quiet: a sentence ending in the
    // word "doc" above a line that opens with a number is only a hit when the
    // number is the one being cited.
    const innocent = [' * see the doc', ' * for the rest.'].join('\n');

    expect(citations(innocent)).toEqual([]);
  });

  it('**3. the durable forms are NOT reported**', () => {
    // The fix has to pass, or the guard argues for a change it cannot accept.
    // ADR numbers, conventions sections and file names are all fine — the rule
    // is about the archive, not about citing things in general.
    const source = [
      '// ADR 0042 records the finding.',
      ' * `development-conventions.md` §13.8 requires it.',
      '// `env-contract.spec.ts` closed that class for `.env.example`.',
      '// See docs/decisions/0043-the-cluster-shape.md.',
      '// Measured: 471 tests, 0 failures.',
    ].join('\n');

    expect(citations(source)).toEqual([]);
  });

  it('**4. the scan reaches real files, not an empty list**', () => {
    // `git ls-files` with a pathspec that matches nothing exits cleanly, so
    // test 1 would pass over zero files and report a compliance it never
    // checked.
    const files = corpus();

    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('docs/development-conventions.md');
    expect(files.every((file) => !EXEMPT.has(file))).toBe(true);
  });
});
