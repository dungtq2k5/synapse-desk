import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { envDocumentedKeys, parseEnvFile } from '../testing/env-file';

/**
 * The CI contract's static half — what a file parse can decide about the
 * workflow, so it fails in `npm run test` rather than on a push.
 *
 * Same split and same reason as `image-contract.spec.ts`: a check that lives
 * only in the thing being configured is a check nobody runs until the thing
 * runs. A workflow is the extreme case — its own checks execute only after
 * somebody pushes the mistake.
 *
 * Corpus discipline as everywhere else: `git ls-files --cached --others
 * --exclude-standard`, never a directory walk, with a floor on every scan so
 * a pattern that stops matching fails instead of passing.
 */
describe('the CI contract', () => {
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

  const workflows = (): string[] => gitFiles('.github/workflows/*.yml');

  // --------------------------------------------------- scripts the jobs name

  describe('every npm script a workflow names exists', () => {
    /**
     * A typo in a job step is a red build that says `Missing script:` — cheap
     * to diagnose and expensive to notice, because it lands on the push that
     * introduced something else. This is the same drift the env-contract and
     * image-contract specs guard between a registry and its code: the
     * workflow is a registry of script names, and `package.json` is the code.
     */
    const scriptNames = (): Set<string> => {
      const names = new Set<string>();

      for (const manifest of [
        'package.json',
        ...gitFiles('*/*/package.json').filter((file) =>
          /^(apps|libs)\/[^/]+\/package\.json$/.test(file),
        ),
        'workers/email-inbound/package.json',
      ]) {
        const parsed = JSON.parse(read(manifest)) as {
          scripts?: Record<string, string>;
        };
        for (const name of Object.keys(parsed.scripts ?? {})) names.add(name);
      }

      return names;
    };

    it('has at least one workflow to check', () => {
      // The floor. Without it this whole describe passes vacuously the day
      // somebody moves or renames the workflow directory.
      expect(workflows().length).toBeGreaterThanOrEqual(1);
    });

    /**
     * `npm run` names actually INVOKED, comments stripped.
     *
     * **The strip is the correction and it was measured.** `cd.yml` runs
     * `docker` and `kubectl` and no npm script at all — its only `npm run` is
     * inside the must-never-run header comment, naming `db:push`. Over raw text
     * that comment satisfied the per-file floor below, so the floor was green
     * on a workflow it had not read a single step of. The destructive check a
     * few lines down already strips YAML comments for the mirror-image reason;
     * this one did not, and the two disagreed about what a workflow says.
     */
    const invocations = (file: string): string[] =>
      [
        ...read(file)
          .replace(/^[ \t]*#.*$/gm, '')
          .matchAll(/npm run ([a-z0-9:_-]+)/g),
      ].map((match) => match[1]);

    it('the corpus invokes npm scripts at all — the pattern-fires floor', () => {
      // **Across the corpus, not per file.** A per-workflow floor asserts
      // something untrue of a deploy job: `cd.yml` legitimately invokes none.
      // The floor still catches the case it exists for — a regex that broke, or
      // steps that moved to a form this cannot read — because `ci.yml` alone
      // invokes eight.
      const total = workflows().flatMap(invocations);

      expect(total.length).toBeGreaterThanOrEqual(5);
    });

    it.each(workflows())('%s', (file) => {
      const declared = scriptNames();

      expect(invocations(file).filter((name) => !declared.has(name))).toEqual(
        [],
      );
    });
  });

  // ------------------------------------------------- the destructive commands

  describe('nothing destructive is wired into a job', () => {
    /**
     * The named list, so its absence from the workflow is a decision rather
     * than an oversight — an absence and an omission look identical to
     * whoever adds the next job.
     *
     * `test:system` flushes the entire dev Redis, drops the Qdrant collection
     * and resets the JetStream streams, in setup AND teardown, and two of its
     * steps need a live paid API. `db:push` (no `:test:`) targets the DEV
     * databases. The seeders' `--apply` forms write to a real Stripe sandbox
     * and real databases; their dry-run forms are harmless, which is why the
     * check is on the flag rather than on the script name for those two.
     */
    const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
      {
        pattern: /npm run test:system\b/,
        why: 'DESTRUCTIVE to Redis, Qdrant and JetStream in setup and teardown',
      },
      {
        // No lookahead. A `(?!:)` here looks like it prevents a false positive
        // on `db:test:push` and cannot: that string does not CONTAIN
        // `db:push`, so the plain pattern never matched it. Its only effect
        // was to exempt the four per-service forms — and `db:push:auth` is
        // literally `npm run db:push -w @synapsedesk/auth-service`, the same
        // command with a workspace flag. Measured: `db:test:push` and
        // `db:test:push:auth` both stay unmatched by the plain pattern, which
        // is what makes the widening safe rather than merely defensible.
        pattern: /npm run db:push\b/,
        why: 'targets the DEV databases; CI wants db:test:push',
      },
      {
        pattern: /npm run (seed:demo|stripe:provision|plans:seed)[^\n]*--apply/,
        why: 'writes to a real Stripe sandbox and real databases',
      },
    ];

    it('has at least one workflow to check', () => {
      expect(workflows().length).toBeGreaterThanOrEqual(1);
    });

    it.each(workflows())('%s', (file) => {
      // **Comments stripped first, and the check found out why by failing on
      // its own subject matter.** The workflow documents this very list in a
      // header comment — the doc's instruction, because an absence and an
      // oversight look identical to whoever adds the next job — so a scan
      // over raw text reads the documentation of the rule as a violation of
      // it. Exactly the hazard `stripComments` exists for in source scans,
      // one file format over: a `#` line in YAML is a line comment.
      const content = read(file).replace(/^[ \t]*#.*$/gm, '');

      // Pattern-fires floor: a workflow with no steps left after stripping
      // means the strip ate the file, and every assertion below would be
      // vacuous.
      expect(content).toMatch(/^\s*-\s+(run|uses):/m);

      const offenders = FORBIDDEN.filter(({ pattern }) =>
        pattern.test(content),
      ).map(({ why }) => `${file}: ${why}`);

      expect(offenders).toEqual([]);
    });
  });

  // ------------------------------------------------- the stack's own env file

  it('**every variable docker-compose reads is documented in .env.example**', () => {
    // The prerequisite CI has that a developer machine hides: compose
    // resolves every `${VAR}` from the ROOT `.env`, which is gitignored, so a
    // fresh checkout starts postgres with no user, no password and no
    // database, and binds the ports somewhere random. It surfaces as e2e
    // suites failing to connect — a test problem, apparently.
    //
    // Same direction as every other guard here: from the code (compose) to
    // the registry (`.env.example`), so a new `${VAR}` fails until it is
    // documented rather than the reverse.
    const compose = read('docker-compose.yml');
    const referenced = [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map(
      (match) => match[1],
    );

    expect(referenced.length).toBeGreaterThanOrEqual(10);

    // **Two questions, because this file is BOTH the documentation and — after
    // `cp .env.example .env` — the configuration.**
    //
    // `envDocumentedKeys` counts commented lines on purpose, and that is right
    // for a SERVICE's `.env.example`, where `# REDIS_DB = 0` documents an
    // optional variable without setting it. It is wrong here: a commented line
    // in the file compose actually reads substitutes an empty string, which is
    // the outage this guard exists to prevent. `parseEnvFile` returns only the
    // ACTIVE `KEY = value` lines, which is the property the second assertion
    // needs.
    //
    // Both, never one: the first names the drift, the second names the outage,
    // and a reader who sees only one of them will eventually simplify it into
    // the wrong one. Measured before this split existed: commenting out
    // `TICKET_DB_PORT` left this check green.
    //
    // The helpers are IMPORTED rather than re-derived — `env-file.ts`'s own
    // docblock is about exactly that: "two ways of counting the same file is
    // how a guard and a document disagree about whether they agree."
    const example = read('.env.example');
    const documented = envDocumentedKeys(example);
    const active = new Set(Object.keys(parseEnvFile(example)));
    const unique = [...new Set(referenced)];

    expect(unique.filter((name) => !documented.has(name))).toEqual([]);
    expect(unique.filter((name) => !active.has(name))).toEqual([]);
  });

  // ------------------------------------------------------ prettier's coverage

  it('**every tracked source file is matched by a prettier glob**', () => {
    // **The phrasing IS the check.** Written as "the globs cover these
    // directories" it would encode the same include-list assumption that
    // created the hole it exists to catch — three times now in this repo: two
    // tsconfig include gaps and the turbo lint gap. Written from the FILES
    // toward the config, a new top-level directory is red on arrival instead
    // of silently unformatted. (`docker/firebase/firebase.json` was red here
    // before the glob was widened to include `docker`.)
    //
    // The globs are read from `package.json`, never restated, so this cannot
    // agree with a stale copy of them.
    const manifest = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };

    const globs = [...manifest.scripts['format:check'].matchAll(/"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((glob) => !glob.startsWith('--'));

    expect(globs.length).toBeGreaterThanOrEqual(3);

    // `.prettierignore` is prettier's own exclusion list and is authoritative
    // for what must NOT be formatted; only its directory and extension
    // entries are needed here.
    const ignored = read('.prettierignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    const isIgnored = (file: string): boolean =>
      ignored.some((entry) => {
        const bare = entry.replace(/^\*\*\//, '').replace(/\/$/, '');
        return (
          file === bare ||
          file.startsWith(`${bare}/`) ||
          file.includes(`/${bare}/`) ||
          matchesGlob(file, entry) ||
          (entry.startsWith('*') && file.endsWith(entry.slice(1)))
        );
      });

    const corpus = [
      ...gitFiles('*.ts'),
      ...gitFiles('*.mjs'),
      ...gitFiles('*.json'),
    ].filter((file) => !isIgnored(file));

    expect(corpus.length).toBeGreaterThanOrEqual(200);

    const unmatched = corpus.filter(
      (file) => !globs.some((glob) => matchesGlob(file, glob)),
    );

    expect(unmatched).toEqual([]);
  });
});
