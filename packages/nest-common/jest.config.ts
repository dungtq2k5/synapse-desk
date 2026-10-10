import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

/**
 * `@synapsedesk/nest-common`'s own tests.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'nest-common',
};

export default config;
