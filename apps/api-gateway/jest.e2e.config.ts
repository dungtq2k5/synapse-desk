import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

/**
 * The e2e layer: the real Nest HTTP stack (guards, pipes, filters,
 * interceptors, cookie parsing, the response envelope) with the gRPC clients
 * stubbed.
 *
 * The gateway owns no database, so what it can prove on its own is the HTTP
 * boundary — and it proves that deterministically only if auth-service is NOT
 * in the loop. See test/utils/grpc-stub.ts.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'api-gateway:e2e',
  testRegex: '\\.e2e-spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 30_000,
};

export default config;
