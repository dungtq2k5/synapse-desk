import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envDocumentedKeys } from '../testing/env-file';
import { stripComments } from '../testing/strip-comments';

/**
 * The environment contract: the schema is the code, `.env.example` is the
 * registry, and this scan runs from the code toward the registry.
 *
 * **Six features in one working session added environment variables and not
 * one reached an example file** — Stripe (docs 59, 63), FCM (doc 65),
 * `WEBHOOK_ALLOW_PRIVATE_TARGETS` (doc 69). That is not carelessness; it is a
 * file maintained by memory. With this scan, a new variable is a schema edit
 * and the build fails until the example catches up.
 *
 * Direction matters and this repository has landed on it five times now: a
 * registry-toward-code scan can only catch renames. The schema decides what
 * exists (§2c: `allowUnknown: true` means an undocumented variable boots
 * silently, so the schema — not `.env` — is the authoritative list).
 */
describe('the environment contract', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  /** The one counting rule — every corpus below comes from git, never a walk. */
  const gitFiles = (pattern: string): string[] =>
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', pattern],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

  /**
   * Documented in `.env.example` but validated by no schema — each with the
   * reason it is real anyway. The `TWINLESS` shape: a named decision, never a
   * pattern, so a hole in the comparison cannot dress up as an exemption.
   */
  const BUILD_INJECTED: ReadonlySet<string> = new Set([
    'APP_VERSION',
    'BUILD_SHA',
    'BUILD_TIME',
  ]);

  /**
   * Services covered by a guard in their OWN toolchain, not this one.
   *
   * rag-service declares its variables in `rag_service/config.py` — required
   * vs optional is `os.environ[...]` vs `.get(..., default)`, at the
   * declaration site — and its guard is
   * `apps/rag-service/tests/test_env_contract.py`, because a TypeScript test
   * parsing Python source would be the only thing crossing the toolchain
   * line this repository keeps everywhere else (`lint:py`, `test:py`).
   */
  const GUARDED_ELSEWHERE: Readonly<Record<string, string>> = {
    'rag-service': 'pytest: apps/rag-service/tests/test_env_contract.py',
  };

  /** apps/<service> for every workspace under apps/. */
  const services = (): string[] =>
    gitFiles('apps/*/package.json')
      .map((file) => file.split('/')[1])
      .sort();

  /** service → its env.validation.ts path, from git rather than a guess. */
  const schemaFiles = (): Map<string, string> => {
    const map = new Map<string, string>();

    for (const file of gitFiles('apps/*/src/**/env.validation.ts')) {
      map.set(file.split('/')[1], file);
    }

    return map;
  };

  /**
   * The keys of a Joi schema, read as text.
   *
   * Text rather than an import because six services' schemas live outside
   * this workspace's program; `stripComments` first because a docblock that
   * NAMES a variable must not count as validating it — the lesson every scan
   * in this repo has re-learned once.
   */
  const schemaKeys = (repoRelative: string): Set<string> => {
    const source = stripComments(
      readFileSync(join(REPO_ROOT, repoRelative), 'utf8'),
    );

    const keys = new Set<string>();
    for (const match of source.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)) {
      keys.add(match[1]);
    }

    return keys;
  };

  const exampleKeys = (service: string): Set<string> => {
    const path = join(REPO_ROOT, 'apps', service, '.env.example');

    if (!existsSync(path)) {
      throw new Error(
        `apps/${service}/.env.example does not exist — every validated ` +
          'variable must be documented there',
      );
    }

    return envDocumentedKeys(readFileSync(path, 'utf8'));
  };

  it('**covers every service** — a moved schema fails rather than skips', () => {
    // The corpus floor. The gateway's schema already sits at a different path
    // (`common/config/` vs `common/configs/`) and is still found — though NOT
    // because `**` is generous: in a git pathspec `a/**/b` requires at least
    // one intervening component, so a schema moved to `apps/x/src/` directly
    // would be MISSED by the glob above. What holds then is this very
    // assertion: `covered` is compared against the real service list, so the
    // dropped service goes red — reading as "schema missing", which is close
    // enough to point at the move. A renamed schema, or a new service with no
    // schema at all, lands in the same diff rather than silently outside the
    // scan.
    const covered = [
      ...schemaFiles().keys(),
      ...Object.keys(GUARDED_ELSEWHERE),
    ].sort();

    expect(covered).toEqual(services());
    expect(schemaFiles().size).toBeGreaterThanOrEqual(6);
  });

  describe.each([...schemaFiles().entries()])('%s', (service, schemaPath) => {
    it('parses at least ten schema keys — the pattern-fires floor', () => {
      // A formatting change that broke the key regex would empty the set and
      // make both directions below vacuously green. The smallest schema
      // (storage-service) holds 13 keys; ten is the floor with margin.
      expect(schemaKeys(schemaPath).size).toBeGreaterThanOrEqual(10);
    });

    it('**every validated variable is documented in .env.example**', () => {
      const documented = exampleKeys(service);
      const missing = [...schemaKeys(schemaPath)].filter(
        (key) => !documented.has(key),
      );

      expect(missing).toEqual([]);
    });

    it('**everything documented is real** — validated, or a named exemption', () => {
      const validated = schemaKeys(schemaPath);
      const phantom = [...exampleKeys(service)].filter(
        (key) => !validated.has(key) && !BUILD_INJECTED.has(key),
      );

      expect(phantom).toEqual([]);
    });
  });

  it('**no tracked env file references docs/archive/**', () => {
    // Tracked files are the publication boundary — an archive citation is
    // unreadable outside this repository and stale inside it. ADRs and
    // docs/reference/ links are fine: the rule is about the archive.
    // (Untracked `.env` files carry more of these; they are a developer's own
    // and do not exist in CI, so no test can hold them — their cleanup was a
    // one-time manual pass.)
    const envFiles = gitFiles('apps/*/.env*');

    // The corpus floor: seven services × (.env.example + .env.test).
    expect(envFiles.length).toBeGreaterThanOrEqual(14);

    const offenders = envFiles.flatMap((file) => {
      const content = readFileSync(join(REPO_ROOT, file), 'utf8');

      return content
        .split('\n')
        .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
        .filter(
          ({ line }) =>
            /docs\/archive/.test(line) ||
            /\d+-doc §/.test(line) ||
            /\bdoc \d+ §/.test(line),
        )
        .map(({ at }) => at);
    });

    expect(offenders).toEqual([]);
  });

  it('**.env.test.local is gitignored in every service**', () => {
    // The override file holds a developer's REAL test credentials (the only
    // place a real secret may live, since .env.test is tracked) — so its
    // ignoredness is a security property, asserted rather than assumed.
    for (const service of services()) {
      const path = `apps/${service}/.env.test.local`;

      let ignored = true;
      try {
        execFileSync('git', ['check-ignore', '-q', path], { cwd: REPO_ROOT });
      } catch {
        ignored = false;
      }

      expect([path, ignored]).toEqual([path, true]);
    }
  });
});
