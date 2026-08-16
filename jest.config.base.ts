import type { Config } from 'jest';

/**
 * Shared jest setup, spread by each workspace's own `jest.config.ts`.
 *
 * Every path below is written relative to a PROJECT directory (`apps/<name>` or
 * `libs/<name>`), because each config sets `rootDir: __dirname`. Writing them as
 * if `<rootDir>` were the repo root — which the previous version did — silently
 * resolves `@synapsedesk/common` to `apps/auth-service/libs/common`, i.e. nothing.
 */
const baseConfig: Config = {
  // `mjs` is here for `pdfjs-dist`, which ships ESM-only and names its files
  // `.mjs` — without it, jest resolves the module and then refuses to transform
  // it, reporting `Unexpected token 'export'` from library internals.
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts'],
  testEnvironment: 'node',

  /**
   * Resolve dual-published packages through their CommonJS entry.
   *
   * Jest's node environment otherwise picks the `import` condition, which hands
   * ts-jest an ESM file it does not transform — the symptom is
   * `SyntaxError: Unexpected token 'export'` from deep inside a dependency
   * (firebase-admin/auth is the one that surfaced it here) with a stack that
   * points at library internals rather than at anything in this repo.
   *
   * These services are compiled to CommonJS in production, so the `require`
   * entry is also the one that actually ships.
   */
  testEnvironmentOptions: {
    customExportConditions: ['node', 'require', 'default'],
  },

  /**
   * Only `*.spec.ts` / `*.test.ts`.
   *
   * The previous pattern was `(.[jt]s)$`, in which `.` is "any character" — so
   * it matched EVERY `.ts` file in the project and jest would have tried to run
   * each source module as a test suite.
   */
  testRegex: String.raw`\.(spec|test)\.[jt]s$`,

  /**
   * `testRegex` above matches `*.e2e-spec.ts` too — it ends in `.spec.ts`.
   * Excluding it here is what keeps `npm test` a pure unit run: the e2e layer
   * needs a live Postgres (auth-service) or a bound HTTP port and Redis
   * (gateway), so left in, the default script fails on a machine with nothing
   * running and stops being the thing anyone runs.
   *
   * Each service's e2e project re-includes itself by overriding this in its own
   * `jest.e2e.config.ts`.
   *
   * **`/dist/` is here because `testRegex` matches `.spec.js`, not just
   * `.spec.ts`.** Under `tsc` that could not bite — `tsconfig.build.json`
   * excludes `**\/*spec.ts` so nothing compiled ever looked like a test. SWC
   * does not read that exclude, and the day the services moved to it, jest
   * collected `dist/src/**\/*.spec.js` alongside the real suites and five
   * "suites" failed to run. The build now ignores specs (see each
   * `nest-cli.json`), so this is the second line rather than the fix: a `dist`
   * left over from before that change, or from a branch that predates it, must
   * not be able to turn `npm test` red for a reason that has nothing to do with
   * the code under test.
   */
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    String.raw`\.e2e-spec\.ts$`,
  ],

  transform: {
    // `.mjs` included for the same reason as `moduleFileExtensions` above: the
    // previous pattern matched `.ts` and `.js` only, so an ESM-only dependency
    // was resolved and then handed to jest untransformed.
    '^.+\\.(t|j|mj)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },

  // Mirrors the `paths` in the root tsconfig. Pointed at the entry FILE rather
  // than the directory, matching each lib's package.json `main`.
  moduleNameMapper: {
    '^@synapsedesk/common$': '<rootDir>/../../libs/common/src/main.ts',
    '^@synapsedesk/common/(.*)$': '<rootDir>/../../libs/common/src/$1',
    '^@synapsedesk/grpc-proto$': '<rootDir>/../../libs/grpc-proto/src/index.ts',
    '^@synapsedesk/grpc-proto/(.*)$': '<rootDir>/../../libs/grpc-proto/src/$1',
  },

  /**
   * These ship ESM-only builds, so they must be transformed rather than skipped.
   *
   * `jose` is here transitively, not because anything imports it directly:
   * firebase-admin -> jwks-rsa -> jose, and jose v6 publishes a single
   * `default` export condition pointing at ESM. Node 22 resolves that from CJS
   * on its own (which is why the service runs); jest does not, and fails with
   * `Unexpected token 'export'` from a file three dependencies deep.
   *
   * The parsing stack needs nothing here. `mammoth`, `turndown` and
   * `turndown-plugin-gfm` are real CommonJS; `js-tiktoken` and
   * `@langchain/textsplitters` declare `type: module` but ship a `.cjs` entry
   * that jest resolves through the `require` condition above.
   *
   * `pdfjs-dist` is the one exception and is deliberately NOT listed. It is
   * ESM-only AND uses `import.meta.url`, which cannot survive a transform to
   * CommonJS at all — so `document-parser.service.ts` loads it through Node's
   * real `require`, bypassing jest's registry entirely. See `loadPdfjs` there.
   */
  transformIgnorePatterns: [
    'node_modules/(?!.*(@scure|otplib|@otplib|@noble|@faker-js|jose))',
  ],

  // Generated Prisma/proto clients are not worth covering and slow the run down.
  coveragePathIgnorePatterns: ['/node_modules/', '/generated/'],

  // `passWithNoTests` is deliberately NOT here: it's a root-only option, and
  // this object gets spread into every apps/*/jest.config.ts, which run under
  // `--projects` (multi-project mode). There, each project config is validated
  // against a stricter per-project schema that rejects root-only options —
  // "not supported in an individual project configuration". Passed as the
  // `--passWithNoTests` CLI flag on the npm scripts instead, which works the
  // same in both single-config and multi-project invocations.
};

export default baseConfig;
