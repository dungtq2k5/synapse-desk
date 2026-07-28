import type { Config } from 'jest';
import baseConfig from '../../jest.config.base';

const config: Config = {
  ...baseConfig,
  rootDir: __dirname,
  // If auth-service ever needs e2e tests alongside unit tests:
  // testMatch: ['**/+(*.)+(spec|test).+(ts|js)', '**/+(*.)+(e2e-spec).+(ts)'],
};

export default config;
