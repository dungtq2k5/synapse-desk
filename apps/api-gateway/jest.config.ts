import type { Config } from 'jest';
// Explicit `.ts` extension: jest loads this config through native ESM
// resolution, which does not do extensionless lookups.
import baseConfig from '../../jest.config.base.ts';

const config: Config = {
  ...baseConfig,
  // ts-jest, PLUS the swagger plugin. REDECLARED rather than spread-and-patched:
  // `transform` is a nested object, so `...baseConfig` copies the reference and
  // mutating it would add the transformer to every other workspace's runs too.
  transform: {
    '^.+\\.(t|j|mj)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        astTransformers: {
          before: ['<rootDir>/jest.swagger-transform.cjs'],
        },
      },
    ],
  },
  // `rootDir` is deliberately omitted — jest defaults it to this file's own
  // directory, and `__dirname` is undefined because configs are evaluated as ESM.
  displayName: 'api-gateway',
};

export default config;
