import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import ts from 'typescript';
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

  // ------------------------------------------------ scripts a job MUST invoke

  describe('every check that must run in CI is wired into a job', () => {
    /**
     * The complement of `FORBIDDEN`, and the gap it closes is the mirror image.
     *
     * The scan above asserts that every script a workflow NAMES exists. It
     * cannot see the other direction: deleting a step removes a name, and a
     * check over names that are present has nothing to say about one that is
     * gone. So `npm run typecheck` could leave `ci.yml` tomorrow and every
     * assertion in this file would stay green.
     *
     * Named, with a `why` each, for the reason `FORBIDDEN` gives: an absence
     * and an oversight look identical to whoever reads the workflow next, and
     * only a list makes the difference visible.
     *
     * **`lint`, not `lint:md`.** Markdown is chained into `lint` rather than
     * given its own step (see `//lint` in package.json), so requiring the step
     * would demand a line whose deletion costs nothing — and requiring the
     * script that actually carries it is what makes this assertion about
     * coverage rather than about layout.
     */
    const REQUIRED: readonly { script: string; why: string }[] = [
      {
        script: 'format:check',
        why: 'prettier is the formatting authority; unrun, the repo drifts one file at a time',
      },
      {
        script: 'lint',
        why: 'eslint, the model-literal check AND lint:md — the composite a developer also runs',
      },
      { script: 'typecheck', why: 'the only whole-repo type check' },
      {
        script: 'proto:lint',
        why: 'buf naming rules; the proto package has no version suffix to fall back on',
      },
      {
        script: 'test',
        why: 'the unit suites, including every contract spec in this directory',
      },
    ];

    /**
     * `npm run <name>` OR `npm <name>`, and the alternation is not cosmetic.
     *
     * `test` is a lifecycle script, so `ci.yml` invokes it as `npm test` —
     * measured. A matcher written only as `npm run <name>` finds five of these
     * six and fails on the one entry that has an npm alias, which reads as a
     * missing step rather than as a missing space.
     *
     * The negative lookahead stops `lint` matching `lint:md` or `lint:py`: a
     * prefix that happens to be another script's stem would satisfy this
     * without the required script running at all.
     */
    const invoked = (content: string, script: string): boolean =>
      new RegExp(
        `npm (?:run )?${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w:-])`,
      ).test(content);

    it('the REQUIRED list is not empty — the floor', () => {
      // A truncated list passes every assertion below while checking nothing.
      expect(REQUIRED.length).toBeGreaterThanOrEqual(5);
    });

    it('**ci.yml invokes each of them**', () => {
      // Comments stripped first, for the reason the destructive scan records:
      // this very list is described in the workflow's own comments, and a scan
      // over raw text would read the documentation of a rule as its
      // observance. Measured there on `cd.yml`, whose only `npm run` is inside
      // a header comment.
      const content = read('.github/workflows/ci.yml').replace(
        /^[ \t]*#.*$/gm,
        '',
      );

      // Pattern-fires floor: if the strip ate the file there are no steps left
      // and every assertion below would be vacuously true.
      expect(content).toMatch(/^\s*-\s+(run|uses):/m);

      const missing = REQUIRED.filter(
        ({ script }) => !invoked(content, script),
      ).map(({ script, why }) => `${script}: ${why}`);

      expect(missing).toEqual([]);
    });

    it('and the matcher does not accept a PREFIX of the script it wants', () => {
      // The assertion above is only worth anything if `lint` fails on a
      // workflow that runs `lint:md` alone. Asserted rather than assumed,
      // because a matcher that is too generous makes the whole list vacuous.
      expect(invoked('- run: npm run lint:md', 'lint')).toBe(false);
      expect(invoked('- run: npm run lint', 'lint')).toBe(true);
      expect(invoked('- run: npm test', 'test')).toBe(true);
      expect(invoked('- run: npm run test:e2e:gateway', 'test')).toBe(false);
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

    /**
     * **Prettier's `*` matches a DOTFILE; `matchesGlob` does not.** Measured on
     * the pair this repo contains rather than argued: prettier formats
     * `docs/reference/erd/.markdownlint.json` under `docs/**\/*.json` — proven
     * by writing a badly-formatted `.probe.json` beside it and watching
     * `--check` report it — while
     * `matchesGlob(file, 'docs/**\/*.json')` is `false`.
     *
     * Unmodelled, that gap makes this test demand a glob for a file prettier
     * ALREADY covers, and the natural response is to widen the glob until the
     * red goes away — which is the test teaching the config to be wrong. The
     * fix belongs here, because prettier is the authority and this is only a
     * model of it.
     *
     * No extra pattern-fires test: that `.markdownlint.json` is in the corpus,
     * so a regression here turns this assertion red on a real file.
     */
    const covered = (file: string): boolean => {
      const dotless = file.replace(/(^|\/)\.(?=[^/]+$)/, '$1');

      return globs.some(
        (glob) => matchesGlob(file, glob) || matchesGlob(dotless, glob),
      );
    };

    const unmatched = corpus.filter((file) => !covered(file));

    expect(unmatched).toEqual([]);
  });

  // ---------------------------------------------------- the markdown ruleset

  describe('the markdown linter cannot go blind and stay green', () => {
    /**
     * `lint:md` reports `0 issues in 0 files` when it is working and when it is
     * not.
     *
     * A config that matched no files, or that switched the ruleset off
     * wholesale, prints the same line as a clean run — there is no output shape
     * that distinguishes them. Every other scan in this directory carries a
     * pattern-fires floor for exactly this; a linter driven by a config file
     * gets the equivalent by asserting the config's SHAPE, because the shape is
     * what decides whether anything is checked at all.
     *
     * The alternative — lint a known-bad fixture and expect a finding — is
     * stronger and heavier: it needs a file that must stay broken, inside a
     * corpus whose whole point is that nothing is broken. The realistic
     * regression is an edit to this config, and this is pointed at that.
     */
    const CLI2_CONFIG = '.markdownlint-cli2.jsonc';
    const ERD_CONFIG = 'docs/reference/erd/.markdownlint.json';

    /**
     * JSONC through the TypeScript parser, NOT a comment-stripper.
     *
     * The same choice `typecheck-coverage.spec.ts` records, for the same
     * measured reason one file type over: `"globs": ["**\/*.md"]` contains
     * `/*`, so a regex stripper looking for the next `*\/` eats everything
     * between one glob and the next. Measured on this exact file with a second
     * glob added — `["**\/*.md", "!**\/*.tmp.md"]` came back as
     * `["***.tmp.md"]` and `JSON.parse` SUCCEEDED, so there is no error to
     * catch and the assertions below would run against a config nobody wrote.
     * A guard that mis-reads the file it guards is the vacuity this describe
     * exists to prevent, arriving through the parser.
     */
    const readJsonc = (repoRelative: string): Record<string, unknown> => {
      const { config, error } = ts.parseConfigFileTextToJson(
        repoRelative,
        read(repoRelative),
      );

      if (error)
        throw new Error(
          ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        );

      return config as Record<string, unknown>;
    };

    it('**the house config still points at every doc, with the ruleset on**', () => {
      const cfg = readJsonc(CLI2_CONFIG);

      // `gitignore` is what excludes the ignored directories — every `.venv`,
      // `node_modules` and the gitignored scratch tree — without a second
      // ignore list to drift from `.gitignore`. Flipped to false, the run would
      // lint personal working material and go red on documents nobody
      // publishes.
      expect(cfg.gitignore).toBe(true);

      // The corpus. Narrowed to a subdirectory, the linter still exits 0 while
      // checking almost nothing, which is the failure with no output shape.
      expect(cfg.globs).toEqual(['**/*.md']);

      const rules = (cfg.config ?? {}) as Record<string, unknown>;

      // **The one key that silences everything.** `default: false` turns every
      // rule off and leaves the run green over all 77 files.
      expect(rules.default).not.toBe(false);

      // **Exactly one rule is off, and a second is a decision.** MD013 is
      // disabled because the house style puts paragraphs in table cells, which
      // cannot wrap — the config says so at length. Anything else switched off
      // wants the same paragraph, and this makes forgetting to write it a red
      // test rather than a quiet narrowing of what CI reads.
      const disabled = Object.entries(rules)
        .filter(([, value]) => value === false)
        .map(([rule]) => rule)
        .sort();

      expect(disabled).toEqual(['MD013']);
    });

    it('**`lint` still carries `lint:md` — the step CI no longer has**', () => {
      // The hole the chaining decision opens, closed here.
      //
      // Markdown has no CI step of its own: `npm run lint` runs it, and the
      // REQUIRED list above asserts `ci.yml` invokes `lint`. Neither says that
      // `lint` still CHAINS `lint:md` — measured, deleting `&& npm run lint:md`
      // from the composite leaves this whole file green while no markdown is
      // checked anywhere. That is the same blindness as an empty glob, one
      // indirection out.
      //
      // Asserted against `package.json` rather than against a run, because the
      // question is whether the wiring exists, not whether the docs pass.
      const pkg = JSON.parse(read('package.json')) as {
        scripts: Record<string, string>;
      };

      expect(pkg.scripts['lint:md']).toBeDefined();
      expect(pkg.scripts.lint).toMatch(/npm run lint:md(?![:\w-])/);
    });

    it('**the ERD exemption is scoped, and it is the only one**', () => {
      // MD041 is off for four GENERATED files that open with a bare ```mermaid
      // fence — `prisma-erd-generator` writes them and would overwrite a
      // hand-added heading. Scoped to that directory so the rule keeps its
      // teeth on hand-written docs; disabled at the root it would cost nothing
      // visible and quietly stop checking all 77.
      const erd = readJsonc(ERD_CONFIG);

      expect(erd.MD041).toBe(false);
      expect(
        Object.keys(erd).filter((key) => key !== '//' && key !== 'MD041'),
      ).toEqual([]);

      // **`gitFiles`, not a directory walk, and not plain `git ls-files`.** The
      // helper passes `--others --exclude-standard`, so it sees a config that
      // is written but not yet committed — the state this very check was
      // written in. Plain `git ls-files` would have found nothing here and
      // passed, which is the vacuity the describe is about; a raw directory
      // walk would instead reach the gitignored scratch tree, which is never
      // linted and whose configs are nobody else's business.
      // **`docs/*.markdownlint*`, and the single star is deliberate.** A git
      // pathspec is not a shell glob: without `:(glob)` a `*` crosses `/`,
      // while `a/**/b` demands at least one intervening component. Measured —
      // `docs/**/.markdownlint*` finds the ERD config and MISSES a
      // `docs/.markdownlint.json` sitting directly in `docs/`, which is
      // precisely where a docs-wide exemption would be put. The narrower-looking
      // pattern was the leakier one.
      const scoped = gitFiles('docs/*.markdownlint*');

      // The floor: an empty result means the pattern stopped matching, and the
      // equality below would then be vacuously true.
      expect(scoped).toEqual([ERD_CONFIG]);
    });
  });
});
