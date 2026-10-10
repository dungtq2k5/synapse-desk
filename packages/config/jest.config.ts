import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

/**
 * The repository guards: specs that read the repository itself.
 */
const config: Config = {
  ...baseConfig,
  displayName: 'config',
};

export default config;
