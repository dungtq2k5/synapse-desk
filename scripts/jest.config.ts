import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../jest.config.base.ts';

/**
 * The demo seeder's unit tests.
 *
 * Its own project because `scripts/` is neither an app nor a lib, and the
 * default run globs `services/*` and `libs/*`.
 *
 * **Nothing here touches a database.** The seeder writes to the DEV databases
 * and a test that seeded one would be writing outside the boundary every suite
 * respects — the family this repository has three known-gap rows about. So the
 * steps separate deciding from writing, and these tests exercise the deciding:
 * the counts, the order, and the ids a step draws from.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'scripts',
  // The base's mappers are written for a project two levels down
  // (`services/<name>`); this one is one level down, so they are restated rather
  // than spread — a `../../libs` from here resolves outside the repository.
  moduleNameMapper: {
    '^@synapsedesk/contracts$': '<rootDir>/../packages/contracts/src/index.ts',
    '^@synapsedesk/core$': '<rootDir>/../packages/core/src/index.ts',
    '^@synapsedesk/nest-common$':
      '<rootDir>/../packages/nest-common/src/index.ts',
    '^@synapsedesk/testing/(.*)$': '<rootDir>/../packages/testing/src/$1',
    '^@synapsedesk/grpc-proto$':
      '<rootDir>/../packages/grpc-proto/src/index.ts',
    '^@synapsedesk/grpc-proto/(.*)$': '<rootDir>/../packages/grpc-proto/src/$1',
  },
  transform: {
    '^.+\\.(t|j|mj)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};

export default config;
