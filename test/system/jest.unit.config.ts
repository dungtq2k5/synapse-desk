import type { Config } from 'jest';
import systemConfig from './jest.config.ts';

/**
 * The harness's OWN unit tests — no stack, no stores, no `globalSetup`.
 *
 * `stack.spec.ts` needs the fleet DOWN (it spawns a fake service and asserts
 * the timeout path reaps it), so it cannot live under the system config, whose
 * every spec runs with the ports held. Named `.spec.ts` precisely so the
 * system `testRegex` cannot match it, and registered in the root `--projects`
 * so `npm test` — which must run on a machine with nothing started — carries
 * it.
 */
const config: Config = {
  ...systemConfig,
  displayName: 'system:unit',
  testRegex: String.raw`test/system/.*\.spec\.ts$`,
  globalSetup: undefined,
  globalTeardown: undefined,
  testTimeout: 30_000,
};

// `delete`, not `: undefined` — under `--projects` jest warns on the KEY being
// present ("testSequencer is not supported in an individual project
// configuration"), and a spread from the system config carries it in.
delete (config as Record<string, unknown>).testSequencer;

export default config;
