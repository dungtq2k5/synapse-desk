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
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',

  /**
   * Only `*.spec.ts` / `*.test.ts`.
   *
   * The previous pattern was `(.[jt]s)$`, in which `.` is "any character" — so
   * it matched EVERY `.ts` file in the project and jest would have tried to run
   * each source module as a test suite.
   */
  testRegex: '\\.(spec|test)\\.[jt]s$',

  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },

  // Mirrors the `paths` in the root tsconfig. Pointed at the entry FILE rather
  // than the directory, matching each lib's package.json `main`.
  moduleNameMapper: {
    '^@synapsedesk/common$': '<rootDir>/../../libs/common/src/main.ts',
    '^@synapsedesk/common/(.*)$': '<rootDir>/../../libs/common/src/$1',
    '^@synapsedesk/grpc-proto$': '<rootDir>/../../libs/grpc-proto/src/index.ts',
    '^@synapsedesk/grpc-proto/(.*)$': '<rootDir>/../../libs/grpc-proto/src/$1',
  },

  // These ship ESM-only builds, so they must be transformed rather than skipped.
  transformIgnorePatterns: [
    'node_modules/(?!.*(@scure|otplib|@otplib|@noble|@faker-js))',
  ],

  // Generated Prisma/proto clients are not worth covering and slow the run down.
  coveragePathIgnorePatterns: ['/node_modules/', '/generated/'],

  // A service with no specs yet is not a failure. Without this, `test:all` goes
  // red the moment a new workspace is scaffolded.
  passWithNoTests: true,
};

export default baseConfig;
