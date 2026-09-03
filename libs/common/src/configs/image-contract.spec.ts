import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { stripComments } from '../testing/strip-comments';

// FIXME Don't reference to impl doc!
/**
 * The image contract's STATIC half — everything about the Docker build that a
 * file parse can decide, so it runs on every `npm run test` instead of
 * whenever somebody remembers to run Docker. The measured argument for that
 * split is `check-ocr-image.sh`: a correct check, in a script nothing runs,
 * red for three weeks while its leftover images sat on the machine reading
 * like current state. The daemon-needing half lives in
 * `docker/check-images.sh`.
 *
 * Corpus discipline as established by docs 68–70: every corpus from
 * `git ls-files --cached --others --exclude-standard` (never a directory
 * walk), `stripComments` before any source is pattern-matched, and a
 * pattern-fires floor on each parse so a regex that silently matches nothing
 * fails instead of passing.
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

    it('every compose image has a tag and none is `latest`', () => {
      const images = [
        ...read('docker-compose.yml').matchAll(/^\s+image:\s+(\S+)$/gm),
      ].map((match) => match[1]);

      // The corpus floor: eight infrastructure services today, one image
      // line each.
      expect(images.length).toBeGreaterThanOrEqual(8);

      for (const image of images) {
        expect([image, image.includes(':')]).toEqual([image, true]);
        expect([image, image.endsWith(':latest')]).toEqual([image, false]);
      }
    });
  });

  // ------------------------------------- the generated container env contract

  it('`.env.docker` is generated, never tracked', () => {
    // FIXME Don't reference to impl doc!
    // The decision doc 70's guard needs made before the file exists: a
    // TRACKED `.env.docker` would enter that guard's archive-reference corpus
    // and NOT its completeness checks (which read `.env.example` by name) — a
    // third hand-maintained value-set with no drift guard, the exact class
    // doc 70 closed. Generated from `.env` by
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
