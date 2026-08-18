import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

/**
 * The e2e layer at auth-service's own boundary: real Prisma against a real
 * Postgres (the TEST database — see .env.test), real service wiring, no mocked
 * repository.
 *
 * "e2e" rather than "integration" per development-conventions §13.1 — it is the
 * same idea as the gateway's suite, applied at a different service's boundary:
 * no mock stands between the test and what a real request actually does inside
 * that service.
 *
 * Separate from `jest.config.ts` because these tests cannot run on a machine
 * with nothing started. Keeping them in the default project would make
 * `npm test` fail for a reason that has nothing to do with the code.
 *
 * Same FILENAME as the gateway's config on purpose: the two are never loaded
 * side by side outside `jest --projects`, where `displayName` disambiguates
 * them in the output.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'auth-service:e2e',
  testRegex: String.raw`\.e2e-spec\.ts$`,

  // Override the base exclusion — this project IS the e2e run, so the files the
  // unit project deliberately skips are the only ones here.
  testPathIgnorePatterns: ['/node_modules/'],

  // Real Postgres round trips, plus a per-file seed that creates the whole
  // permission catalogue. The 5s jest default trips on the seed alone.
  testTimeout: 30_000,
};

export default config;
