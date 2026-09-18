import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envDocumentedKeys, parseEnvFile } from '../testing/env-file';
import { stripComments } from '../testing/strip-comments';

/**
 * The environment contract: the schema is the code, `.env.example` is the
 * registry, and this scan runs from the code toward the registry.
 *
 * **Six features in one working session added environment variables and not
 * one reached an example file** — Stripe twice, FCM, and
 * `WEBHOOK_ALLOW_PRIVATE_TARGETS`. That is not carelessness; it is a
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

  // -------------------------------- values that must be the SAME in two files

  describe('**one value, one spelling**', () => {
    /**
     * Variables whose whole meaning is that two services agree on them.
     *
     * **The placeholder is the contract here, not just an illustration.** A
     * developer copies both `.env.example` files, and if the two carry
     * different strings the copy PRODUCES the misconfiguration. That is what
     * happened: `INBOUND_EMAIL_SECRET` shipped as
     * `…-shared-with-the-worker` in the gateway and
     * `…-shared-with-the-gateway` in notification — each half-true, together a
     * guaranteed mismatch on step one.
     *
     * **And the mismatch is SILENT.** `manifest-contract.spec.ts` spells the
     * consequence out: `parseTicketReplyToken` returns `null`, the caller opens
     * a NEW ticket — correctly, since threading a stranger's mail onto somebody
     * else's conversation is a disclosure — and nothing is logged. It presents
     * weeks later as "threading stopped working".
     *
     * Only variables that MUST be byte-identical belong here. `DATABASE_URL`
     * appears in every service and is legitimately different in each, so a
     * blanket "same key, same value" rule would be wrong; this is a named list
     * for the same reason `BUILD_INJECTED` above is.
     */
    const SHARED: Readonly<Record<string, readonly string[]>> = {
      INBOUND_EMAIL_SECRET: ['api-gateway', 'notification-service'],
      // The domain the catch-all serves. notification writes `Reply-To` at it
      // and the gateway parses what comes back; two spellings is mail that
      // routes out and cannot route in.
      INBOUND_EMAIL_DOMAIN: ['api-gateway', 'notification-service'],
    };

    /** `KEY = value` from an example file, values trimmed, comments skipped. */
    const valueOf = (service: string, key: string): string | undefined => {
      const source = readFileSync(
        join(REPO_ROOT, `apps/${service}/.env.example`),
        'utf8',
      );

      return new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm').exec(source)?.[1]?.trim();
    };

    it('**1. every shared variable reads the same in every example**', () => {
      const disagreements: string[] = [];

      for (const [key, holders] of Object.entries(SHARED)) {
        const seen = holders.map((service) => ({
          service,
          value: valueOf(service, key),
        }));

        // Absent is a disagreement too — a shared value documented in one file
        // and not the other is the same copy-and-diverge, one step earlier.
        if (new Set(seen.map(({ value }) => value)).size > 1) {
          disagreements.push(
            `${key}: ${seen
              .map(({ service, value }) => `${service}=${value ?? '(absent)'}`)
              .join(' vs ')}`,
          );
        }
      }

      expect(disagreements).toEqual([]);
    });

    it('**2. …and the reader actually finds the values**', () => {
      // A regex that stopped matching would report every pair as agreeing,
      // because `undefined === undefined`. This is the floor that stops test 1
      // passing over nothing.
      for (const [key, holders] of Object.entries(SHARED)) {
        for (const service of holders) {
          expect([service, key, valueOf(service, key)]).not.toEqual([
            service,
            key,
            undefined,
          ]);
        }
      }
    });
  });

  // ------------------------- values that must be DERIVED from another service

  describe('**cookie lifetimes follow the tokens they carry**', () => {
    /**
     * Each gateway cookie against the auth-service lifetime of the token in it.
     *
     * The rule is the comment above the values in the gateway's
     * `.env.example`: access, refresh and 2FA run one second past their token,
     * device and tenant-selection equal theirs. It was written down and not
     * checked, and `COOKIE_REFRESH_MAX_AGE` shipped as `10081000` — 2 h 48 min,
     * against a seven-day refresh token — so an idle user was logged out while
     * the server still honoured the token.
     *
     * Each file is compared with its OWN counterpart (`.env.test` with
     * `.env.test`), so a test file that shortens a token for suite speed keeps
     * its rows true without being forced to production values.
     */
    const ROWS = [
      {
        cookie: 'COOKIE_ACCESS_MAX_AGE',
        token: 'JWT_ACCESS_EXPIRES_IN',
        unit: 'duration',
        plusMs: 1000,
      },
      {
        cookie: 'COOKIE_2FA_MAX_AGE',
        token: 'JWT_2FA_EXPIRES_IN',
        unit: 'duration',
        plusMs: 1000,
      },
      {
        cookie: 'COOKIE_REFRESH_MAX_AGE',
        token: 'REFRESH_TOKEN_TTL_DAYS',
        unit: 'days',
        plusMs: 1000,
      },
      {
        cookie: 'COOKIE_DEVICE_MAX_AGE',
        token: 'TRUSTED_DEVICE_TTL_DAYS',
        unit: 'days',
        plusMs: 0,
      },
      {
        cookie: 'COOKIE_TENANT_SELECTION_MAX_AGE',
        token: 'JWT_TENANT_SELECTION_EXPIRES_IN',
        unit: 'duration',
        plusMs: 0,
      },
    ] as const;

    const FILES = ['.env.example', '.env.test'] as const;

    const DURATION_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const DAY_MS = DURATION_MS.d;

    /**
     * A token lifetime in milliseconds — `15m`, `1h`, `7d`, and nothing else.
     *
     * **Throws on any other form** rather than returning `undefined`.
     * jsonwebtoken also accepts `7 days` and bare numbers; a parser that
     * skipped those would drop the row they appear in and still pass.
     */
    const lifetimeMs = (value: string, unit: 'duration' | 'days'): number => {
      const match =
        unit === 'days' ? /^(\d+)$/.exec(value) : /^(\d+)([smhd])$/.exec(value);

      if (!match) {
        throw new Error(`Unrecognised ${unit} '${value}' — extend the parser`);
      }

      return unit === 'days'
        ? Number(match[1]) * DAY_MS
        : Number(match[1]) * DURATION_MS[match[2] as keyof typeof DURATION_MS];
    };

    const envOf = (service: string, file: string): Record<string, string> =>
      parseEnvFile(
        readFileSync(join(REPO_ROOT, 'apps', service, file), 'utf8'),
      );

    it.each(FILES)(
      '**%s: every cookie outlives or equals its token by the rule**',
      (file) => {
        const gateway = envOf('api-gateway', file);
        const auth = envOf('auth-service', file);

        const wrong = ROWS.flatMap(({ cookie, token, unit, plusMs }) => {
          const expected = lifetimeMs(auth[token], unit) + plusMs;
          const actual = Number(gateway[cookie]);

          return actual === expected
            ? []
            : [
                `${cookie} = ${gateway[cookie]}, expected ${expected} (${token} = ${auth[token]})`,
              ];
        });

        expect(wrong).toEqual([]);
      },
    );

    it('**…and all ten lookups find a value** — the pattern-fires floor', () => {
      // A renamed key would make its row compare two absences.
      // `Number(undefined)` is `NaN` and fails the comparison today, but only
      // by accident of arithmetic; this states it.
      for (const file of FILES) {
        const gateway = envOf('api-gateway', file);
        const auth = envOf('auth-service', file);

        for (const { cookie, token } of ROWS) {
          expect([file, cookie, gateway[cookie]]).not.toEqual([
            file,
            cookie,
            undefined,
          ]);
          expect([file, token, auth[token]]).not.toEqual([
            file,
            token,
            undefined,
          ]);
        }
      }
    });

    it('the lifetime parser reads the forms in use and refuses the rest', () => {
      expect(lifetimeMs('15m', 'duration')).toBe(900_000);
      expect(lifetimeMs('1h', 'duration')).toBe(3_600_000);
      expect(lifetimeMs('7', 'days')).toBe(604_800_000);
      expect(() => lifetimeMs('7 days', 'duration')).toThrow(/unrecognised/i);
      expect(() => lifetimeMs('900', 'duration')).toThrow(/unrecognised/i);
      expect(() => lifetimeMs('7d', 'days')).toThrow(/unrecognised/i);
    });
  });
});
