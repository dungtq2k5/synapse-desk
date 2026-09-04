import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { parseEnvFile } from '../testing/env-file';
import { stripComments } from '../testing/strip-comments';

/**
 * The schema-delivery contract: what may reach a production image, and what
 * the seeder is allowed to make optional.
 *
 * Item 35 — *"not include testing databases when push to production"* — was
 * already true when it was written, and true by three separate accidents of
 * configuration rather than by anything asserting it. These checks say so, so
 * that it stays true the day somebody adds a fifth service or edits a
 * `.dockerignore` line whose purpose is not obvious from the line itself.
 */
describe('the schema contract', () => {
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

    const corpus = gitFiles('*').filter(
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

    const offenders = corpus.filter((file) => {
      // Binary and generated artefacts are not worth reading; none of them is
      // a place a database URL is written by hand.
      if (!/\.(ts|mjs|js|json|ya?ml|sh|env|md|prisma|py)$/.test(file)) {
        return false;
      }

      return /synapsedesk_[a-z]+_test/.test(read(file));
    });

    expect(offenders).toEqual([]);
  });

  it('the exclusions that make check 1 true are still declared', () => {
    // Check 1 passes because of two rules. If either is deleted, check 1 goes
    // red on its own — but it would say "a file names a test database", which
    // points at the file rather than at the rule that stopped mattering.
    expect(read('.dockerignore')).toMatch(/^\*\*\/\.env\.\*$/m);

    const buildConfigs = gitFiles('apps/*/tsconfig.build.json');
    expect(buildConfigs.length).toBeGreaterThanOrEqual(6);

    for (const file of buildConfigs) {
      const parsed = JSON.parse(stripComments(read(file))) as {
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
    const seeders = gitFiles('apps/*/src/modules/prisma/database.seeder.ts');
    expect(seeders.length).toBeGreaterThanOrEqual(4);

    for (const seeder of seeders) {
      const service = seeder.split('/')[1];
      const schema = gitFiles(`apps/${service}/src/**/env.validation.ts`)[0];
      const declared = /SEED_ON_BOOTSTRAP:/.test(read(schema));

      // `seedRows` exists only where there are rows to seed.
      const seedsRows = /async seedRows\(/.test(read(seeder));

      expect([service, declared]).toEqual([service, seedsRows]);

      if (declared) {
        expect([
          service,
          /SEED_ON_BOOTSTRAP: Joi\.boolean\(\)\.required\(\)/.test(
            read(schema),
          ),
        ]).toEqual([service, true]);
      }
    }
  });

  it('**every seeder applies its schema objects outside any flag**', () => {
    // **The CALL SITE, not the declaration.** This assertion used to test that
    // a method named `applySchemaObjects` existed — equally true of a seeder
    // that calls it from INSIDE the seeding branch, which is the exact defect
    // this phase removed. Measured: restoring that defect in auth left this
    // spec 5/5 green, ticket's behavioural spec green, and auth's own 471-test
    // suite green. What matters is that nothing conditional stands between the
    // hook and the DDL.
    //
    // A source regex is brittle and this one earns it: it is the only check
    // covering all four services at once, and the edit it catches is the edit
    // a refactor would make.
    const seeders = gitFiles('apps/*/src/modules/prisma/database.seeder.ts');
    expect(seeders.length).toBeGreaterThanOrEqual(4);

    for (const seeder of seeders) {
      const source = stripComments(read(seeder));
      const hook =
        /async onApplicationBootstrap\([\s\S]*?\n {2}\}/.exec(source)?.[0] ??
        '';

      // Pattern-fires floor: no hook parsed means the regex stopped matching
      // and the assertion below is vacuous.
      expect([seeder, hook.length > 0]).toEqual([seeder, true]);

      const beforeAnyBranch = hook.split(/\bif\s*\(/)[0];

      expect([
        seeder,
        /await this\.(applySchemaObjects|seed)\(\)/.test(beforeAnyBranch),
      ]).toEqual([seeder, true]);
    }
  });

  // ------------------------------- 4. the published super-admin passwords

  it('**the schema refuses every super-admin password this repo publishes**', () => {
    // Read from the files that publish them, never restated here: a guard
    // that hard-coded the strings would agree with a stale copy of itself.
    // `.env.example` is the contract a deployer follows; `.env.test` is
    // tracked and rides into `.env.docker` through the generator.
    const published = [
      parseEnvFile(read('apps/auth-service/.env.example')).SUPER_ADMIN_PASSWORD,
      parseEnvFile(read('apps/auth-service/.env.test')).SUPER_ADMIN_PASSWORD,
    ];

    expect(published.filter(Boolean)).toHaveLength(2);

    const schema = read(
      'apps/auth-service/src/common/configs/env.validation.ts',
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
