import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

/**
 * Unit tests for the shared proto library.
 *
 * The mappers live here, so their tests do too — putting them in a service's
 * suite would make one service the accidental owner of a conversion both use,
 * and the other service's build could break them silently.
 *
 * Nothing in this project needs a database or a network: every export under
 * test is a pure function over a value.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'grpc-proto',
};

export default config;
