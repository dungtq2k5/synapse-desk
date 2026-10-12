import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

/**
 * `@synapsedesk/api-client`'s own tests: the fetcher, not the generated code.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'api-client',
};

export default config;
