import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

const config: Config = {
  ...baseConfig,
  // `rootDir` is deliberately omitted: jest already defaults it to the
  // directory holding this file, and the previous `rootDir: __dirname` throws
  // "__dirname is not defined in ES module scope" because jest evaluates
  // TypeScript configs as ESM.
  displayName: 'auth-service',
};

export default config;
