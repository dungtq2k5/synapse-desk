import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

/**
 * `@synapsedesk/contracts`'s own tests.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'contracts',
};

export default config;
