import type { Config } from 'jest';

/**
 * The harness's OWN unit tests — no stack, no stores, no `globalSetup`.
 *
 * `stack.spec.ts` needs the fleet DOWN (it spawns a fake service and asserts
 * the timeout path reaps it), so it cannot live under the system config, whose
 * every spec runs with the ports held. Named `.spec.ts` precisely so the
 * system `testRegex` cannot match it, and registered in the root `--projects`
 * so `npm test` — which must run on a machine with nothing started — carries
 * it.
 *
 * Standalone rather than a spread of `jest.config.ts`: importing that file
 * makes Node load it itself, and where `test/` declares no module type it
 * warns (MODULE_TYPELESS_PACKAGE_JSON) on every run. `stack.spec.ts` imports
 * no `@synapsedesk` package, so it needs none of that config's mappings.
 */
const config: Config = {
  displayName: 'system:unit',
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: String.raw`test/system/.*\.spec\.ts$`,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 30_000,
};

export default config;
