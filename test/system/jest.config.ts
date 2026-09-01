import type { Config } from 'jest';

/**
 * The system harness.
 *
 * **Deliberately not a `--projects` member.** `npm test` must stay runnable on a
 * machine with nothing started; this one resets four stores, spawns seven
 * processes and takes minutes. Mixing them would make the fast suite fail for
 * reasons that have nothing to do with the code.
 *
 * `maxWorkers: 1` rather than `--runInBand` on the command line, because the
 * constraint is a property of the suite: one stack, one journey, shared state
 * between steps by design.
 */
const config: Config = {
  displayName: 'system',
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: String.raw`\.system-spec\.ts$`,
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
  // **Path order, because the default is file SIZE.** `zz-harness` stops a
  // service on purpose and must run last; naming it `zz-` expressed the intent
  // and enforced nothing — measured, the harness check ran first and the smoke
  // test then failed on a port the suite had freed itself.
  testSequencer: '<rootDir>/sequencer.cjs',
  // A cross-service effect polls with its own deadline; this is the outer
  // bound, generous because the whole fleet is on one machine.
  testTimeout: 120_000,
};

export default config;
