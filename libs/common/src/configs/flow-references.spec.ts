import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Every symbol a flow document names still exists.
 *
 * **A flow document has no runtime.** `env-contract`, `image-contract` and
 * `manifest-contract` each guard a file that something else also reads, so a
 * wrong one eventually breaks a boot or a build. Nothing executes
 * `docs/reference/flows/`, and its failure mode is a developer following a
 * paragraph to a function that was renamed six months ago.
 *
 * The `flows/README.md` convention list is what makes this checkable: *symbols,
 * never line numbers*. A line number rots on the next edit and cannot be
 * verified; a symbol either resolves or it does not.
 *
 * **Two floors, and they answer different questions.** The corpus floor asks
 * *did we read the documents* — this is the one guard whose corpus can vanish
 * to a `git mv`, and a glob matching nothing passes forever. The pattern-fires
 * floor asks *can the extractor still see a citation* — because a glob that
 * matches seven files and a matcher that matches nothing look identical from
 * the outside, which is the same equivalence as a missing `redis-cli` reporting
 * zero keys.
 */
describe('every symbol the flow documents cite exists', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  const gitFiles = (pattern: string): string[] =>
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', pattern],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

  const read = (repoRelative: string): string =>
    readFileSync(join(REPO_ROOT, repoRelative), 'utf8');

  const flows = (): string[] => gitFiles('docs/reference/flows/*.md');

  /**
   * The extensions a flow document may cite — **named once**, because three
   * things derive from it and any two of them drifting apart is a blind spot
   * rather than a failure.
   *
   * Measured before this was one list: `declaredConstants` read
   * `libs|apps` only (1,062 of 1,154 tracked source files, missing `scripts/`,
   * `k8s/`, `.github/` and `docker/`), so a constant declared only outside
   * those two failed test 4 while plainly existing. And test 5's line-number
   * pattern covered `ts|py|mjs` while
   * `FILE_CITATION` covered seven, so `` `docker-compose.yml:42` `` was
   * invisible to the WHOLE guard: too narrow for test 5, and unmatched by test 3
   * because the backtick no longer follows the extension.
   */
  const CITED_EXTENSIONS = [
    'ts',
    'py',
    'mjs',
    'yml',
    'yaml',
    'toml',
    'prisma',
  ] as const;

  const EXTENSIONS = CITED_EXTENSIONS.join('|');

  /** One corpus for both halves — the same files, read the same way. */
  const sourceFiles = (): string[] =>
    CITED_EXTENSIONS.flatMap((extension) => gitFiles(`*.${extension}`));

  /**
   * Backticked filenames — `rerank.py`, `cache.config.ts`, `docker-compose.yml`.
   *
   * Matched on BASENAME rather than path: the documents name a file to send a
   * reader to it, not to assert where it lives, and pinning the directory
   * would make every move a documentation failure rather than a rename.
   */
  const FILE_CITATION = new RegExp(`\`([\\w.-]+\\.(?:${EXTENSIONS}))\``, 'g');

  /** The same extensions, with a line number — refused by test 5. */
  const LINE_CITATION = new RegExp(`[\\w.-]+\\.(?:${EXTENSIONS}):\\d+`, 'g');

  /** Backticked SCREAMING_SNAKE constants — `MAX_PAGE_SIZE`, `RRF_K`. */
  const CONST_CITATION = /`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g;

  const citationsIn = (source: string, pattern: RegExp): string[] => [
    ...new Set([...source.matchAll(pattern)].map((match) => match[1])),
  ];

  /** Every tracked source basename, once. */
  const trackedBasenames = (): Set<string> =>
    new Set(sourceFiles().map((file) => basename(file)));

  /**
   * Constants declared anywhere in tracked source.
   *
   * **The same corpus as `trackedBasenames`**, deliberately: a document citing
   * `docker-compose.yml` and a document citing a constant from `scripts/` are asking the same
   * question about the same file, and answering them from two different file
   * sets is how one passes while the other fails.
   */
  const declaredConstants = (): Set<string> => {
    const declared = new Set<string>();
    const pattern = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

    for (const file of sourceFiles()) {
      for (const [, name] of read(file).matchAll(pattern)) declared.add(name);
    }

    return declared;
  };

  it('**1. the corpus is the flows directory, and it is not empty**', () => {
    // THE floor that matters here. Every other contract spec reads files that
    // something else needs too; move this directory and nothing else notices.
    const files = flows();

    // Seven today: six flows plus the index. Jest prints the received number on
    // failure, which is the count this floor exists to make visible.
    expect(files.length).toBeGreaterThanOrEqual(7);
    expect(files).toContain('docs/reference/flows/README.md');
    expect(files).toContain('docs/reference/flows/rag-answering.md');
  });

  it('**2. …and the extractors can actually SEE a citation**', () => {
    // Pattern-fires. A matcher that stopped matching reports "no broken
    // citations", which is indistinguishable from a clean corpus.
    const corpus = flows().map(read).join('\n');

    expect(citationsIn(corpus, FILE_CITATION).length).toBeGreaterThanOrEqual(
      10,
    );
    expect(citationsIn(corpus, CONST_CITATION).length).toBeGreaterThanOrEqual(
      10,
    );
  });

  it('**3. every cited FILE exists**', () => {
    const tracked = trackedBasenames();
    const missing: string[] = [];

    for (const file of flows()) {
      for (const cited of citationsIn(read(file), FILE_CITATION)) {
        if (!tracked.has(cited)) missing.push(`${basename(file)} → ${cited}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('**4. every cited CONSTANT is declared**', () => {
    const declared = declaredConstants();
    const missing: string[] = [];

    for (const file of flows()) {
      for (const cited of citationsIn(read(file), CONST_CITATION)) {
        if (!declared.has(cited)) missing.push(`${basename(file)} → ${cited}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('**5. no flow document cites a line number**', () => {
    // The convention that makes tests 3 and 4 possible at all. A `file.ts:214`
    // cannot be verified by anything, so it is refused rather than checked.
    const offenders: string[] = [];

    for (const file of flows()) {
      const hits = [...read(file).matchAll(LINE_CITATION)];
      if (hits.length > 0) offenders.push(`${basename(file)}: ${hits[0][0]}`);
    }

    expect(offenders).toEqual([]);
  });
});
