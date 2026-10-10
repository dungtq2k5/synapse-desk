import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

const config: Config = {
  ...baseConfig,
  // `rootDir` is deliberately omitted — jest defaults it to this file's own
  // directory, and `__dirname` is undefined because configs are evaluated as ESM.
  displayName: 'storage-service',
};

export default config;
