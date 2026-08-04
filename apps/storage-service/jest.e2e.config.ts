import type { Config } from 'jest';
import baseConfig from '../../jest.config.base.ts';

/**
 * The e2e layer at storage-service's boundary: a real Firebase Storage
 * EMULATOR and a real (test-index) Redis, no mocks between the test and what a
 * request actually does.
 *
 * "Real infra, no mocks" means something different here than for the other
 * services, because this one has no Postgres at all (§1.2) — the infra it needs
 * is the emulator plus Redis. Pointing tests at a real bucket would be the same
 * mistake as pointing them at the dev database, applied to cloud infra.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'storage-service:e2e',
  testRegex: String.raw`\.e2e-spec\.ts$`,
  testPathIgnorePatterns: ['/node_modules/'],
  // Emulator round trips plus signing.
  testTimeout: 30_000,
};

export default config;
