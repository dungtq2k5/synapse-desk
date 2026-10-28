import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { parseEnvFile } from '@synapsedesk/testing/env-file';
import { stripComments } from '@synapsedesk/testing/strip-comments';
import { seederObjectNames } from '@synapsedesk/testing/schema-objects';
import {
  readListed,
  readRepoFiles,
  repoFiles,
} from '@synapsedesk/testing/repo-files';

/**
 * The schema-delivery contract: what may reach a production image, and what
 * the seeder is allowed to make optional.
 *
 * The rule that testing databases never reach a production image was
 * already true when it was written, and true by three separate accidents of
 * configuration rather than by anything asserting it. These checks say so, so
 * that it stays true the day somebody adds a fifth service or edits a
 * `.dockerignore` line whose purpose is not obvious from the line itself.
 */
describe('the schema contract', () => {
  const REPO_ROOT = join(__dirname, '../../..');

  const read = (repoRelative: string): string =>
    readFileSync(join(REPO_ROOT, repoRelative), 'utf8');

  // ------------------------------------------- 1. test databases stay out

  it('**no file that can reach a runtime image names a `_test` database**', () => {
    // **The corpus is the check.** "Files that can reach an image" is
    // `git ls-files` minus what `.dockerignore` keeps out of the build context
    // minus what `tsconfig.build.json` keeps out of `dist` — computing it is
    // the assertion, because a hand-listed version passes the day a fifth
    // service arrives. Today the answer is seven files and all seven are
    // excluded by a rule rather than by luck: five `.env.test` by
    // `**/.env.*`, two specs by `test` and `**/*spec.ts`.
    const ignored = read('.dockerignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    const excludedFromContext = (file: string): boolean =>
      ignored.some((entry) => {
        const bare = entry.replace(/^\*\*\//, '').replace(/\/$/, '');
        return (
          matchesGlob(file, entry) ||
          matchesGlob(file, `${entry}/**`) ||
          file === bare ||
          file.startsWith(`${bare}/`) ||
          file.includes(`/${bare}/`) ||
          file.split('/').pop() === bare
        );
      });

    // Never compiled into `dist`, so a runtime image cannot carry them.
    const excludedFromBuild = (file: string): boolean =>
      /(^|\/)test\//.test(file) || /spec\.ts$/.test(file);

    const corpus = repoFiles('*').filter(
      (file) => !excludedFromContext(file) && !excludedFromBuild(file),
    );

    // **948 today, and the floor is set close to it deliberately.** At 400
    // the exclusion predicates could swallow more than half the repository
    // before firing — and they are the generous half of this check:
    // `excludedFromContext` matches six ways, one of them on basename alone
    // (`file.split('/').pop() === bare`), which excludes a file anywhere in
    // the tree whose name equals a `.dockerignore` entry. Same margin the
    // other floors here use.
    expect(corpus.length).toBeGreaterThanOrEqual(900);

    const offenders = readListed(
      // Binary and generated artefacts are not worth reading; none of them is
      // a place a database URL is written by hand.
      corpus.filter((file) =>
        /\.(ts|mjs|js|json|ya?ml|sh|env|md|prisma|py)$/.test(file),
      ),
    )
      .filter(({ text }) => /synapsedesk_[a-z]+_test/.test(text))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('the exclusions that make check 1 true are still declared', () => {
    // Check 1 passes because of two rules. If either is deleted, check 1 goes
    // red on its own — but it would say "a file names a test database", which
    // points at the file rather than at the rule that stopped mattering.
    expect(read('.dockerignore')).toMatch(/^\*\*\/\.env\.\*$/m);

    const buildConfigs = repoFiles('services/*/tsconfig.build.json');
    expect(buildConfigs.length).toBeGreaterThanOrEqual(6);

    for (const { path: file, text } of readListed(buildConfigs)) {
      const parsed = JSON.parse(stripComments(text)) as {
        exclude?: string[];
      };

      expect([file, parsed.exclude]).toEqual([
        file,
        expect.arrayContaining(['test', '**/*spec.ts']),
      ]);
    }
  });

  // --------------------------------- 3. the seeding flag, where it belongs

  it('**only a service that seeds rows declares `SEED_ON_BOOTSTRAP`**', () => {
    // The flag means "skip inserting rows". Three services seed none, so it
    // gated nothing there but the DDL Prisma cannot express — 17 of the 26
    // objects, removed by the setting a careful operator reaches for. They no
    // longer declare it; auth does, and `required()` like its peers, because
    // an unset seeding flag should stop a service rather than choose for it.
    const seeders = repoFiles(
      'services/*/src/modules/prisma/database.seeder.ts',
    );
    expect(seeders.length).toBeGreaterThanOrEqual(4);

    for (const { path: seeder, text: seederSource } of readListed(seeders)) {
      const service = seeder.split('/')[1];
      const schema = readRepoFiles(
        `services/${service}/src/**/env.validation.ts`,
      )[0].text;
      const declared = /SEED_ON_BOOTSTRAP:/.test(schema);

      // `seedRows` exists only where there are rows to seed.
      const seedsRows = /async seedRows\(/.test(seederSource);

      expect([service, declared]).toEqual([service, seedsRows]);

      if (declared) {
        expect([
          service,
          /SEED_ON_BOOTSTRAP: Joi\.boolean\(\)\.required\(\)/.test(schema),
        ]).toEqual([service, true]);
      }
    }
  });

  it('**every seeder ASSERTS its schema outside any flag**', () => {
    // **The CALL SITE, not the declaration.** This assertion used to test that
    // a method named `applySchemaObjects` existed — equally true of a seeder
    // that calls it from INSIDE the seeding branch, which is the exact defect
    // ADR 0042 removed. Measured then: restoring that defect in auth left this
    // spec 5/5 green, ticket's behavioural spec green, and auth's own 471-test
    // suite green. What matters is that nothing conditional stands between the
    // hook and the schema step.
    //
    // **What the hook owes changed with ADR 0043 and the invariant did not.**
    // The DDL moved to the init container, so the hook no longer APPLIES —
    // it ASSERTS, via `assertSchemaExists()`. That is the same guard aimed one
    // step earlier: ADR 0042's finding was a schema step that could be
    // skipped without anything noticing, and a boot path that fell silent when
    // the step moved would recreate it exactly. A pod whose migration did not
    // run must refuse to serve rather than serve 500s, and a service started
    // outside Kubernetes — which gets no init container at all — has nothing
    // else watching.
    //
    // `applySchemaObjects` is still ACCEPTED here, deliberately: a service that
    // has not moved yet is not broken, and this check is about the branch, not
    // about which of the two the hook chose.
    //
    // A source regex is brittle and this one earns it: it is the only check
    // covering all four services at once, and the edit it catches is the edit
    // a refactor would make.
    const seeders = repoFiles(
      'services/*/src/modules/prisma/database.seeder.ts',
    );
    expect(seeders.length).toBeGreaterThanOrEqual(4);

    for (const { path: seeder, text } of readListed(seeders)) {
      const source = stripComments(text);
      const hook =
        /async onApplicationBootstrap\([\s\S]*?\n {2}\}/.exec(source)?.[0] ??
        '';

      // Pattern-fires floor: no hook parsed means the regex stopped matching
      // and the assertion below is vacuous.
      expect([seeder, hook.length > 0]).toEqual([seeder, true]);

      const beforeAnyBranch = hook.split(/\bif\s*\(/)[0];

      expect([
        seeder,
        /await this\.(assertSchemaExists|applySchemaObjects|seed)\(\)/.test(
          beforeAnyBranch,
        ),
      ]).toEqual([seeder, true]);
    }
  });

  // ------------------------------ 3b. the migrations, and their one boundary

  describe("**the migrations exist and stay out of the seeder's territory**", () => {
    const withSchema = (): string[] =>
      repoFiles('services/*/prisma/schema.prisma')
        .map((file) => file.split('/')[1])
        .sort();

    /** Every object `applySchemaObjects()` creates, by name (`seederObjectNames`). */
    const seederObjects = (service: string): string[] =>
      seederObjectNames(
        read(`services/${service}/src/modules/prisma/database.seeder.ts`),
      );

    it('extracts twenty-five named objects plus one extension — the floor', () => {
      // auth 9, ticket 6, ingestion 7 (six indexes and `btree_gin`),
      // notification 4 = 26.
      //
      // **The prose said twenty-six for three ADRs, and this is why it is a
      // test now.** That figure came from a raw `grep -c` over the seeders,
      // uncomment-stripped, which counted two matches inside docblocks — auth
      // 10 instead of 8, ticket 6 instead of 5. It then propagated to ADR 0039,
      // ADR 0042, ADR 0043, the Dockerfile and `k8s/README.md`, none of which
      // could disagree with each other because they were all copies of one
      // uncorrected count.
      //
      // ADR 0039's own thesis is that a prose enumeration of database objects
      // has no verifier. The count was the enumeration it did not think it was
      // making — and so is THE LIST IN THE PARAGRAPH ABOVE, which names five
      // places and there are ten: it omits ADR 0044, the root `README.md`, and
      // the docblock at the top of all four `schema-apply.ts` files.
      //
      // **The number lives in two kinds of place.** The ADRs keep theirs as
      // history — append-only, dated to their commits. No editable copy carries
      // a digit; each says "the objects `schema-apply.ts` owns", because a
      // bumped number only schedules this paragraph again. This assertion is
      // the one live figure, and it is a test rather than a sentence.
      const named = withSchema().flatMap(seederObjects);
      const extensions = withSchema()
        .map((service) =>
          stripComments(
            read(`services/${service}/src/modules/prisma/database.seeder.ts`),
          ),
        )
        .join('\n')
        .match(/CREATE EXTENSION/gi);

      expect(named).toHaveLength(25);
      expect(extensions?.length).toBe(1);
    });

    it.each(withSchema())('%s has a migration', (service) => {
      // Check 3. `migrate deploy` with an empty `migrations/` directory exits
      // non-zero, so the init container holds the pod at `Init:Error` forever —
      // the safe failure, and a slow way to discover a missing directory.
      const migrations = readRepoFiles(
        `services/${service}/prisma/migrations/*/migration.sql`,
      );

      // The baseline is the first by name: Prisma applies them in that order,
      // and a listing puts an uncommitted one wherever git does.
      const [baseline] = [...migrations].sort((a, b) =>
        a.path.localeCompare(b.path),
      );

      expect(migrations.length).toBeGreaterThanOrEqual(1);
      expect(baseline.text.length).toBeGreaterThan(500);
    });

    it.each(withSchema())(
      "%s's migrations create nothing `schema-apply` owns",
      (service) => {
        // **Check 4, and the forbidden set is DERIVED rather than listed.** The
        // objects have one producer today; a migration is exactly
        // where a second would appear, because writing `CREATE INDEX` in SQL is
        // the obvious thing to do when you are already writing SQL. Two
        // producers are invisible until they disagree.
        //
        // Measured on the generated `0_init` files: zero overlap, zero
        // `WHERE`-clause partial indexes, zero `CHECK` constraints, and the
        // `ADD CONSTRAINT` lines Prisma does emit are all foreign keys. The
        // reason is structural rather than lucky — `schema.prisma` declares no
        // `postgresqlExtensions`, so `migrate diff` cannot see `btree_gin` at
        // all, and it has no syntax for a partial index.
        const forbidden = seederObjects(service);
        expect(forbidden.length).toBeGreaterThanOrEqual(4);

        const sql = readRepoFiles(
          `services/${service}/prisma/migrations/*/migration.sql`,
        )
          .map(({ path, text }) => `${path}\n${text}`)
          .join('\n');

        expect(sql.length).toBeGreaterThan(500);

        const collisions = forbidden.filter((name) => sql.includes(name));
        expect(collisions).toEqual([]);

        // The three shapes a hand-edit would take even under a new name.
        expect(/CREATE EXTENSION/i.test(sql)).toBe(false);
        expect(/USING GIN/i.test(sql)).toBe(false);
        expect(/CREATE (?:UNIQUE )?INDEX[^;]*\sWHERE\s/i.test(sql)).toBe(false);
      },
    );
  });

  // -------------------- 3a. one schema step, three commands, every environment

  describe('**every database gets its schema the way production does**', () => {
    /**
     * The schema step is three commands, in this order, `&&`-chained:
     * `database-check.js` (refuses a missing or `db push`-built database),
     * `prisma migrate deploy`, `schema-apply.js` (the objects Prisma cannot
     * express). Production runs them as the `migrate` image's `CMD`; every
     * other environment runs them as the service's `npm run db:apply`.
     */
    const withSchema = (): string[] =>
      repoFiles('services/*/prisma/schema.prisma')
        .map((file) => file.split('/')[1])
        .sort();

    const scriptsOf = (pkg: string): Record<string, string> =>
      (
        JSON.parse(read(`${pkg}/package.json`)) as {
          scripts: Record<string, string>;
        }
      ).scripts;

    const imageCmd = (): string =>
      /^CMD \["sh", "-c", "([^"]+)"\]/m.exec(
        read('docker/node-service.Dockerfile'),
      )?.[1] ?? '';

    it('four services own a Prisma schema — the corpus floor', () => {
      expect(withSchema()).toHaveLength(4);
    });

    it('the migrate image runs the three commands, in order, in one container', () => {
      expect(imageCmd()).toBe(
        'node dist/src/database-check.js && npx prisma migrate deploy && node dist/src/schema-apply.js',
      );
    });

    it.each(withSchema())(
      "%s: `db:apply` is the image's three commands",
      (service) => {
        for (const [entry, call] of [
          ['database-check', /runDatabaseCheck\(\)/],
          ['schema-apply', /applySchemaObjects\(\)/],
        ] as const) {
          const file = `services/${service}/src/${entry}.ts`;
          expect([file, call.test(stripComments(read(file)))]).toEqual([
            file,
            true,
          ]);
        }

        const scripts = scriptsOf(`services/${service}`);

        // `npx` resolves the same binary `npm run` puts on the PATH.
        expect(scripts['db:apply']).toBe(
          imageCmd().replace('npx prisma', 'prisma'),
        );
        expect(scripts['db:apply:test']).toBe(
          'dotenv -e .env.test -- npm run db:apply',
        );
        expect(
          Object.keys(scripts)
            .filter((name) => name.startsWith('db:'))
            .sort(),
        ).toEqual(
          [
            'db:apply',
            'db:apply:test',
            'db:generate',
            'db:migrate',
            // notification has no Studio script.
            ...(service === 'notification-service' ? [] : ['db:studio']),
          ].sort(),
        );
      },
    );

    it('the root has four database scripts, and the reset applies the schema', () => {
      expect(
        Object.keys(scriptsOf('.'))
          .filter((name) => name.startsWith('db:'))
          .sort(),
      ).toEqual(['db:apply', 'db:apply:test', 'db:generate', 'db:reset']);

      const reset = stripComments(read('scripts/reset-databases.mjs'));
      expect([/'db:apply'/.test(reset), /'db:apply:test'/.test(reset)]).toEqual(
        [true, true],
      );
    });

    it("**the system suite's setup applies the schema to the dev databases**", () => {
      expect(stripComments(read('test/system/global-setup.ts'))).toMatch(
        /'db:apply'/,
      );
    });

    it('**nothing that sets up a database calls `db push`**', () => {
      // Package scripts, the root scripts, the test setups and CI: every
      // place a database is created, reset or updated. `npx prisma db push`
      // by hand stays possible for an experiment; no setup may use it.
      const packages = repoFiles('package.json', '*/*/package.json');
      const sources = repoFiles(
        'scripts/*.mjs',
        'scripts/**/*.ts',
        'test/**/*.ts',
        '.github/workflows/*.yml',
      );
      expect(packages.length).toBeGreaterThanOrEqual(10);
      expect(sources.length).toBeGreaterThanOrEqual(20);

      const PUSH = /\bdb\s+push\b|\bdb:(?:test:)?push\b/;
      const offenders = [
        ...readListed(packages)
          .filter(({ text }) =>
            Object.values(
              (JSON.parse(text) as { scripts?: Record<string, string> })
                .scripts ?? {},
            ).some((script) => PUSH.test(script)),
          )
          .map(({ path }) => path),
        ...readListed(sources)
          .filter(({ path, text }) =>
            PUSH.test(
              path.endsWith('.yml')
                ? text.replace(/^\s*#.*$/gm, '')
                : stripComments(text),
            ),
          )
          .map(({ path }) => path),
      ];

      expect(offenders).toEqual([]);
    });
  });

  // ------------------------------- 4. the published super-admin passwords

  it('**the schema refuses every super-admin password this repo publishes**', () => {
    // Read from the files that publish them, never restated here: a guard
    // that hard-coded the strings would agree with a stale copy of itself.
    // `.env.example` is the contract a deployer follows; `.env.test` is
    // tracked and rides into `.env.docker` through the generator.
    const published = [
      parseEnvFile(read('services/auth-service/.env.example'))
        .SUPER_ADMIN_PASSWORD,
      parseEnvFile(read('services/auth-service/.env.test'))
        .SUPER_ADMIN_PASSWORD,
    ];

    expect(published.filter(Boolean)).toHaveLength(2);

    const schema = read(
      'services/auth-service/src/common/configs/env.validation.ts',
    );

    for (const password of published) {
      expect([password, schema.includes(`'${password}'`)]).toEqual([
        password,
        true,
      ]);
    }

    // And the refusal is wired to the field, not merely present in the file.
    expect(schema).toMatch(
      /SUPER_ADMIN_PASSWORD[\s\S]{0,600}?PUBLISHED_SUPER_ADMIN_PASSWORDS/,
    );
  });
});
