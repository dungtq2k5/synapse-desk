import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { stripComments } from '../testing/strip-comments';

/**
 * The image contract's STATIC half — everything about the Docker build that a
 * file parse can decide, so it runs on every `npm run test` instead of
 * whenever somebody remembers to run Docker. The measured argument for that
 * split is `check-ocr-image.sh`: a correct check, in a script nothing runs,
 * red for three weeks while its leftover images sat on the machine reading
 * like current state. The daemon-needing half lives in
 * `docker/check-images.sh`.
 *
 * Corpus discipline as `development-conventions.md` §13.8 requires it: every
 * corpus from `git ls-files --cached --others --exclude-standard` (never a
 * directory walk), `stripComments` before any source is pattern-matched, and
 * a pattern-fires floor on each parse so a regex that silently matches
 * nothing fails instead of passing.
 */
describe('the image contract (static half)', () => {
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

  // ----------------------------------------------------- phantom dependencies

  describe('every src/ import is declared in its own package manifest', () => {
    /**
     * `turbo prune` is the first thing in this repo that enforces per-package
     * declarations, and six packages failed it at once: npm hoists one
     * package's dependency to the root, a sibling resolves it by walking up,
     * and the accident holds until a pruned build removes it. The build half
     * fails in the image (`libs/common`'s type-only `ioredis`); the RUNTIME
     * half is worse — `storage-service`'s `import 'dotenv/config'` on line 2
     * of `main.ts` compiled clean and would have died at `docker run`.
     *
     * `src/generated/`  is IN the corpus, deliberately: generated code ships
     * and has to resolve at runtime like any other file, and two of
     * `libs/grpc-proto`'s three phantom imports lived in it — an exclusion
     * that felt like hygiene would have dropped the majority of that
     * package's findings.
     *
     * Spec and test files are IN — a premise that flipped once, measured:
     * "specs never enter an image" is true of the RUNTIME image and false of
     * the build stage, whose in-image typecheck covers `src` and `test`
     * alike. notification's `test/utils/bootstrap.ts` imported
     * `@nestjs/testing` undeclared, and the second full image run — not this
     * spec — was what caught it.
     */
    const BUILTIN = new Set(
      builtinModules.flatMap((name) => [name, `node:${name}`]),
    );

    const packageOf = (specifier: string): string => {
      const parts = specifier.split('/');
      return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    };

    /**
     * Statement-anchored, not free-floating: a bare `from\s+['"]` also
     * matches PROSE inside string literals — measured, `'AI reply drafting'`
     * and a GraphQL field named `from` both landed in the phantom list. Each
     * pattern here requires the syntactic shape of the statement itself.
     */
    const IMPORT_PATTERNS = [
      /^\s*import\s+['"]([^'"]+)['"]/gm, // side-effect: import 'dotenv/config'
      // `[^'"\n]` — the span must stay on ONE line, or `export class …`
      // anchors and the span crosses lines to a template literal containing
      // ` from '…'` (measured: attachment-extractor's error message).
      // Multi-line imports are the `tail` pattern's job.
      /^\s*(?:import|export)\s[^'"\n]*?\sfrom\s+['"]([^'"]+)['"]/gm,
      /^\s*}?\s*from\s+['"]([^'"]+)['"];?\s*$/gm, // multi-line import's tail
      // `(?<![.\w])` — a bare call, never a METHOD: `this.require('AI reply
      // drafting')` is a domain method in ticket-service and matched without
      // the lookbehind.
      /(?<![.\w])require\(\s*['"]([^'"]+)['"]\s*\)/g,
      /(?<![.\w])import\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    const importsOf = (source: string): Set<string> => {
      const found = new Set<string>();
      const stripped = stripComments(source);

      for (const pattern of IMPORT_PATTERNS) {
        for (const match of stripped.matchAll(pattern)) {
          const spec = match[1];
          if (spec.startsWith('.') || spec.startsWith('@synapsedesk/'))
            continue;

          const pkg = packageOf(spec);
          if (!BUILTIN.has(pkg) && !BUILTIN.has(spec)) found.add(pkg);
        }
      }

      return found;
    };

    /**
     * Workspaces this check does not cover, each with its reason — the
     * TWINLESS shape, so a hole cannot dress up as an exemption.
     */
    const GUARDED_ELSEWHERE: Readonly<Record<string, string>> = {
      'apps/rag-service':
        'Python — pip has no workspace hoisting to hide an undeclared ' +
        'import, and requirements.txt was audited for exactly that (its ' +
        'google-genai and flashrank docblocks are that audit)',
    };

    const workspaces = (): string[] =>
      gitFiles('*/*/package.json')
        .filter((file) => /^(apps|libs)\/[^/]+\/package\.json$/.test(file))
        .map((file) => file.slice(0, -'/package.json'.length))
        .filter((workspace) => !(workspace in GUARDED_ELSEWHERE))
        .sort();

    it('scans at least eight packages — the corpus floor', () => {
      // Six apps and two libs today. A `git ls-files` pattern that stops
      // matching must fail rather than report a clean tree.
      expect(workspaces().length).toBeGreaterThanOrEqual(8);
    });

    it.each(workspaces())('%s', (workspace) => {
      const manifest = JSON.parse(read(`${workspace}/package.json`)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);

      // DIRECTORY pathspecs, filtered in JS. The exact rule, measured: in a
      // git pathspec without `:(glob)`, `*` is plain fnmatch and CROSSES `/`
      // (`apps/*/src/*.ts` -> 643 files), while `a/**/b` is special-cased to
      // require at least one intervening component (`apps/*/src/**/*.ts` ->
      // 631, zero directly in `src/`) — so `**` is NARROWER than the `*`
      // beside it, the opposite of shell globstar and `.gitignore`, which is
      // where the intuition comes from. The first version of this corpus used
      // `src/**/*.ts` and was blind to `main.ts` and `app.module.ts` in every
      // workspace; measured by sabotage: a phantom import added to storage's
      // `main.ts` — the file the whole check was motivated by — came back
      // green.
      const sources = [
        ...gitFiles(`${workspace}/src`),
        ...gitFiles(`${workspace}/test`),
      ].filter((file) => file.endsWith('.ts'));

      const used = new Map<string, string>();
      for (const file of sources) {
        for (const pkg of importsOf(read(file))) {
          if (!used.has(pkg)) used.set(pkg, file);
        }
      }

      // The pattern-fires floor: a package whose parse finds NO external
      // imports means the import regex broke, not that the package is
      // self-sufficient — every workspace here imports at least Nest.
      expect(used.size).toBeGreaterThanOrEqual(1);

      const phantom = [...used.entries()]
        .filter(([pkg]) => !declared.has(pkg))
        .map(([pkg, file]) => `${pkg} (first: ${file})`);

      expect(phantom).toEqual([]);
    });
  });

  // ------------------------------------------------- types are dev-only

  it('no @types/* package sits in production dependencies', () => {
    // Found by check 3 of `check-images.sh`, live: the gateway declared
    // `@types/cookie-parser` in `dependencies`, so the runtime image
    // installed a package of nothing but declaration files — and the
    // resolve check failed on it, because a types package has no module to
    // resolve. Types are build-time input; `--omit=dev` is the line that
    // makes the distinction matter.
    const manifests = gitFiles('*/*/package.json').filter((file) =>
      /^(apps|libs)\/[^/]+\/package\.json$/.test(file),
    );
    expect(manifests.length).toBeGreaterThanOrEqual(8);

    const offenders = manifests.flatMap((file) => {
      const manifest = JSON.parse(read(file)) as {
        dependencies?: Record<string, string>;
      };

      return Object.keys(manifest.dependencies ?? {})
        .filter((pkg) => pkg.startsWith('@types/'))
        .map((pkg) => `${file}: ${pkg}`);
    });

    expect(offenders).toEqual([]);
  });

  // ----------------------------------------------- cross-workspace relatives

  describe('no relative import escapes its workspace', () => {
    /**
     * The class the first in-image typecheck run caught: a gateway SPEC
     * imported `../../../../auth-service/src/common/utils/text` — reaching
     * into a sibling workspace by path, which resolves on a developer machine
     * and cannot exist in a pruned single-service build. Spec files are IN
     * this corpus (unlike the phantom check's), because the in-image
     * typecheck covers them and that is exactly where the measured case
     * lived. The legitimate cross-workspace channel is `@synapsedesk/*`.
     */
    it.each(['apps', 'libs'])('%s', (top) => {
      // `src/**` + JS filter, and the spelling is measured: `${top}/*/src`
      // matches NOTHING (a pathspec with a wildcard is not a prefix), and
      // `src/**/*.ts` misses files directly in `src/` — the same git `**`
      // blind spot the phantom corpus above documents. `src/**` returns all
      // 644 files including the six `main.ts`.
      const files = [
        ...gitFiles(`${top}/*/src/**`),
        ...gitFiles(`${top}/*/test/**`),
      ].filter((file) => file.endsWith('.ts'));

      // The corpus floor — a glob that stops matching must fail, not pass.
      expect(files.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const file of files) {
        const workspaceDepth = 2; // apps/<name>/…
        const fileDepth = file.split('/').length - 1 - workspaceDepth;
        const stripped = stripComments(read(file));

        for (const match of stripped.matchAll(
          /(?:from\s+|^\s*import\s+)['"]((?:\.\.\/)+[^'"]*)['"]/gm,
        )) {
          const ups = match[1].match(/\.\.\//g)?.length ?? 0;

          if (ups > fileDepth) offenders.push(`${file} -> ${match[1]}`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  // ------------------------------------------------------------ version pins

  describe('the Dockerfile agrees with the manifests it duplicates', () => {
    /**
     * Two versions live in both a manifest and a Dockerfile ARG, because the
     * image cannot read the manifest at the moment it needs them. Duplicated
     * numbers drift; this is the tether. Measured before the pin existed: the
     * prune stage ran turbo 2.10.12 from the network while the build stage
     * ran the lockfile's 2.10.9 — the same Dockerfile, two turbos.
     */
    const dockerfile = (): string => read('docker/node-service.Dockerfile');

    const arg = (name: string): string => {
      const match = new RegExp(`^ARG ${name}=(\\S+)$`, 'm').exec(dockerfile());

      if (!match) throw new Error(`ARG ${name} not found in the Dockerfile`);
      return match[1];
    };

    it('TURBO_VERSION equals the lockfile turbo', () => {
      const lock = JSON.parse(read('package-lock.json')) as {
        packages: Record<string, { version?: string }>;
      };

      expect(arg('TURBO_VERSION')).toBe(
        lock.packages['node_modules/turbo'].version,
      );
    });

    it('NPM_VERSION equals packageManager', () => {
      const manifest = JSON.parse(read('package.json')) as {
        packageManager?: string;
      };

      expect(`npm@${arg('NPM_VERSION')}`).toBe(manifest.packageManager);
    });

    it('.nvmrc equals the image base version', () => {
      // The third place a Node version is named. CI reads `.nvmrc` through
      // `setup-node`'s `node-version-file`, the image reads `NODE_VERSION`,
      // and nothing tied them — a CI that tests a runtime the image does not
      // ship is a CI whose green means less than it appears to.
      //
      // `engines.node: ">=22.12"` in ingestion-service is deliberately NOT in
      // this comparison: it is a FLOOR with a stated reason (pdfjs-dist is
      // ESM-only and loaded through `createRequire`), and a floor and a pin
      // are allowed to differ.
      const image = /^(\d+\.\d+\.\d+)/.exec(arg('NODE_VERSION'));

      expect(image).not.toBeNull();
      expect(read('.nvmrc').trim()).toBe(image?.[1]);
    });
  });

  // ------------------------------------------------------- the types major

  describe('every `@types/node` describes the runtime that runs', () => {
    /**
     * The FOURTH place a Node version is named, and the only one that was
     * unbound.
     *
     * `@types/node`'s major tracks the Node major — 26.x describes Node 26 —
     * so a manifest on `^26` while `.nvmrc` says 24 typechecks the code
     * against an API surface the runtime does not have. That compiles green
     * and throws in the container, which is the same shape as the assertion
     * above, arriving through the types instead of the image.
     *
     * **Four of five manifests were on `^26` when this was written**, and none
     * of them by decision: `npm i -D @types/node` resolves the `latest` tag,
     * which is the CURRENT Node line and not the LTS this repo pins. That is
     * the whole failure mode — a default, applied four times, with nothing
     * reading it back. The fifth (`storage-service`) was on `^24` and right,
     * which is what a rule with no guard looks like: correct by luck in one
     * place out of five.
     *
     * MAJORS only, deliberately. The minor is a types release, not a runtime
     * one, and a caret already floats it; requiring the full version would
     * redden on a DefinitelyTyped publish that changes nothing here.
     *
     * DECLARED ranges in tracked manifests, never the lockfile: `@fast-csv`
     * carries its own pinned `@types/node@14` in a nested tree, which is that
     * package's business and not a statement about this runtime.
     */
    const manifests = (): string[] =>
      // `*` in a git pathspec is plain fnmatch and CROSSES `/`, so these two
      // reach every depth. Verified, not assumed — the doubled-star spelling
      // would MISS the root `package.json`, which is one of the four.
      gitFiles('package.json').concat(gitFiles('*/package.json'));

    /** `^24.13.3` -> `24`. Any range prefix (`^`, `~`, `>=`, none) is fine. */
    const major = (range: string): string | undefined =>
      /(\d+)\./.exec(range)?.[1];

    const declarations = (): { file: string; range: string }[] =>
      manifests().flatMap((file) => {
        const manifest = JSON.parse(read(file)) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const range =
          manifest.devDependencies?.['@types/node'] ??
          manifest.dependencies?.['@types/node'];

        return range ? [{ file, range }] : [];
      });

    it('**1. every declared major equals `.nvmrc`**', () => {
      const runtime = major(read('.nvmrc').trim());

      expect(runtime).toBeDefined();

      const wrong = declarations()
        .filter(({ range }) => major(range) !== runtime)
        .map(({ file, range }) => `${file}: ${range} — expected ^${runtime}.x`);

      expect(wrong).toEqual([]);
    });

    it('**2. …and the check can actually SEE a mismatch**', () => {
      // Guards the guard, with the exact value this was written for.
      expect(major('^26.4.1')).toBe('26');
      expect(major('^24.13.3')).toBe('24');
      expect(major('~24.10.1')).toBe('24');
      expect(major('>=22.12')).toBe('22');
      expect(major('24.13.3')).toBe('24');
    });

    it('**3. the scan reaches real manifests, not an empty list**', () => {
      // A pathspec that matches nothing exits cleanly, so test 1 would pass
      // over zero declarations and report a compliance it never checked.
      const found = declarations();

      expect(manifests()).toContain('package.json');
      // Not a workspace, so reaching it proves the pathspec is not the
      // workspace globs in disguise.
      expect(manifests()).toContain('scripts/package.json');
      // Four manifests declare it: the root, `libs/common`, `libs/grpc-proto`
      // and `storage-service`.
      expect(found.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ------------------------------------------------------- the compose network

  describe('every `--network` names the network compose creates', () => {
    /**
     * `docker-compose.yml` renames the default network, and two files quote
     * that name in a command a reader is meant to paste.
     *
     * **It had already drifted.** `generate-docker-env.mjs` said
     * `synapse-desk_default` — compose's *derived* default, `<dir>_<network>` —
     * while `docker-compose.yml` sets `networks.default.name:
     * synapsedesk-network`. The instruction failed with "network not found",
     * which is loud, but it is the first command in the container workflow and
     * the README now repeats it.
     *
     * DERIVED from the tree rather than from a list of files: a third place
     * that quotes the flag is covered on arrival, which is the property a
     * two-entry list would not have.
     */
    const composeNetwork = (): string => {
      const match = /^networks:\n\s+default:\n\s+name:\s*(\S+)/m.exec(
        read('docker-compose.yml'),
      );

      if (!match) throw new Error('networks.default.name not found in compose');
      return match[1];
    };

    const mentions = (): { file: string; network: string }[] =>
      gitFiles('*')
        .filter((file) => /\.(mjs|ts|md|sh|ya?ml)$/.test(file))
        .flatMap((file) =>
          [...read(file).matchAll(/--network[= ]([A-Za-z0-9_.-]+)/g)].map(
            ([, network]) => ({ file, network }),
          ),
        );

    it('**1. no `--network` quotes a name compose does not create**', () => {
      const expected = composeNetwork();

      const wrong = mentions()
        .filter(({ network }) => network !== expected)
        .map(({ file, network }) => `${file}: --network ${network}`);

      expect(wrong).toEqual([]);
    });

    it('**2. the scan finds the mentions, and the compose name**', () => {
      // A regex that stopped matching would report a clean tree over zero
      // occurrences — the vacuity shape this file's other scans guard the same
      // way.
      expect(composeNetwork()).toBe('synapsedesk-network');
      expect(mentions().length).toBeGreaterThanOrEqual(2);
    });
  });

  // ------------------------------------------------------------ floating tags

  describe('no image reference floats', () => {
    /**
     * A floating tag makes an image a function of the pull date — measured:
     * `node:24-alpine` moved npm from 11.17.0 to 11.19.0 between two pulls
     * one hour apart, across the release that changed whether install
     * scripts run at all.
     *
     * Two strengths, deliberately: the DOCKERFILE base ARGs must pin a full
     * `x.y.z` (node and python both version that way), while compose images
     * must merely not float on `latest` — postgres's `18.4` IS its full
     * version, so a uniform three-component rule would false-flag a correct
     * pin. `nats:2.10-alpine` floats across 2.10.x and is the accepted
     * residual of that looseness.
     */
    it('the Dockerfile base ARGs pin a full version', () => {
      const cases = [
        ['docker/node-service.Dockerfile', 'NODE_VERSION'],
        ['docker/rag-service.Dockerfile', 'PYTHON_VERSION'],
      ] as const;

      for (const [file, name] of cases) {
        const match = new RegExp(`^ARG ${name}=(\\S+)$`, 'm').exec(read(file));

        if (!match) throw new Error(`ARG ${name} not found in ${file}`);
        expect([name, /^\d+\.\d+\.\d+/.test(match[1])]).toEqual([name, true]);
      }
    });

    /**
     * **From the FILES toward the config.** This check read
     * `docker-compose.yml` by name and was green on eleven `:latest` tags in
     * `k8s/` — a directory that did not exist when it was written, holding the
     * eleven images this repository actually ships.
     *
     * That is the fifth instance of one shape here: two `tsconfig` include
     * gaps, the turbo lint gap, the prettier glob gap, and this. The prettier
     * check was rewritten specifically to avoid it — *"written from the FILES
     * toward the config, a new top-level directory is red on arrival instead of
     * silently unformatted"* — and this one was not, so it repeated.
     *
     * **The pathspec is deliberately the loose form.** In a git pathspec
     * without `:(glob)`, `*` is plain fnmatch and CROSSES `/`, so `'*.yaml'`
     * reaches `k8s/services/*.yaml`; the doubled-star form requires an
     * intervening component and would be NARROWER. Measured: 32 files, 21
     * `image:` lines.
     */
    const imageRefs = (): { file: string; image: string }[] =>
      gitFiles('*.yml')
        .concat(gitFiles('*.yaml'))
        .flatMap((file) =>
          [...read(file).matchAll(/^\s+image:\s+(\S+)$/gm)].map((match) => ({
            file,
            image: match[1],
          })),
        );

    it('finds at least twenty image references — the corpus floor', () => {
      // Twenty-two today: nine in compose, thirteen in `k8s/`. A pathspec or a
      // regex that stopped matching would make both assertions below vacuous,
      // which is the failure this check exists to prevent, arriving through the
      // check.
      const refs = imageRefs();

      expect(refs.length).toBeGreaterThanOrEqual(20);
      // Both directories represented, so a corpus that silently narrowed back
      // to one file is red rather than merely smaller.
      expect(refs.some(({ file }) => file === 'docker-compose.yml')).toBe(true);
      expect(refs.some(({ file }) => file.startsWith('k8s/'))).toBe(true);
    });

    it('every image reference has a tag and none is `latest`', () => {
      const floating = imageRefs().filter(
        ({ image }) => !image.includes(':') || image.endsWith(':latest'),
      );

      // An omitted tag counts as floating for the same reason `:latest` does —
      // `imagePullPolicy` defaults to `Always` for both, so every pod restart
      // becomes an opportunity to run different code.
      expect(floating.map(({ file, image }) => `${file}: ${image}`)).toEqual(
        [],
      );
    });

    /**
     * **Application images name a registry; third-party images do not have to.**
     *
     * `nats:2.10-alpine` and `qdrant/qdrant:v1.18.3` are unqualified Docker Hub
     * references and correctly so. `synapsedesk/auth-service` is unqualified and
     * WRONG: it resolves to Docker Hub, which is not where these images are — a
     * pull failure if the name is unclaimed, and something considerably worse if
     * it is not. So the rule is scoped by the prefix rather than by directory,
     * the same set `docker/check-images.sh` already means by
     * `docker images 'synapsedesk/*'`.
     */
    const APPLICATION_IMAGE = /(?:^|\/)synapsedesk\//;

    it('the application-image pattern fires', () => {
      expect(
        [
          'synapsedesk/auth-service:abc',
          'us-central1-docker.pkg.dev/proj/synapsedesk/auth-service:abc',
        ].filter((image) => !APPLICATION_IMAGE.test(image)),
      ).toEqual([]);

      expect(
        [
          'nats:2.10-alpine',
          'qdrant/qdrant:v1.18.3',
          'postgres:18.4-alpine',
        ].filter((image) => APPLICATION_IMAGE.test(image)),
      ).toEqual([]);
    });

    it('**every application image names a registry host**', () => {
      const application = imageRefs().filter(({ image }) =>
        APPLICATION_IMAGE.test(image),
      );

      // Eleven today: seven runtime images and four `migrate` images.
      expect(application.length).toBeGreaterThanOrEqual(11);

      // A registry host is the first path segment when it contains a `.` or a
      // `:` — Docker's own rule for telling `myregistry.io/x` from the implicit
      // `docker.io/library/x`.
      const unqualified = application.filter(({ image }) => {
        const [first] = image.split('/');

        return !first.includes('.') && !first.includes(':');
      });

      expect(unqualified.map(({ file, image }) => `${file}: ${image}`)).toEqual(
        [],
      );
    });
  });

  // ------------------------------------- the generated container env contract

  it('`.env.docker` is generated, never tracked', () => {
    // The decision `env-contract.spec.ts` needs made before the file exists:
    // a TRACKED `.env.docker` would enter that guard's archive-reference
    // corpus and NOT its completeness checks (which read `.env.example` by
    // name) — a third hand-maintained value-set with no drift guard, the exact
    // class that guard closed for `.env.example`. Generated from `.env` by
    // `scripts/generate-docker-env.mjs` (host addresses swapped for compose
    // service names), it cannot drift by construction — provided it stays
    // untracked, which is what this pins.
    expect(gitFiles('apps/*/.env.docker')).toEqual([]);

    let ignored = true;
    try {
      execFileSync(
        'git',
        ['check-ignore', '-q', 'apps/auth-service/.env.docker'],
        { cwd: REPO_ROOT },
      );
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(true);
  });
});
