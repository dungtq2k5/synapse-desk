import type { Config } from 'jest';

/**
 * The gateway contract harness.
 *
 * **Not a `--projects` member**, for the reason `test/system/jest.config.ts`
 * gives about itself: `npm test` must stay runnable on a machine with nothing
 * started, and this one pulls two containers and starts a gateway process.
 *
 * `maxWorkers: 1` because the rows share one started gateway and one pair of
 * containers. Two CONCURRENT invocations of the whole suite are a different
 * thing and must work — every port here is ephemeral and every container is
 * this run's own, which `global-teardown.ts` asserts.
 */
const config: Config = {
  displayName: 'gateway-contract',
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: String.raw`\.contract-spec\.ts$`,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@synapsedesk/common$': '<rootDir>/../../libs/common/src/main.ts',
    '^@synapsedesk/common/(.*)$': '<rootDir>/../../libs/common/src/$1',
    '^@synapsedesk/grpc-proto$': '<rootDir>/../../libs/grpc-proto/src/index.ts',
    '^@synapsedesk/grpc-proto/(.*)$': '<rootDir>/../../libs/grpc-proto/src/$1',
  },
  globalSetup: '<rootDir>/global-setup.ts',
  globalTeardown: '<rootDir>/global-teardown.ts',
  maxWorkers: 1,
  testTimeout: 60_000,
};

export default config;
