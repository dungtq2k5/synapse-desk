import type { Config } from 'jest';

/** The offline Worker's decision, run in Node, which has `Request` and `Response`. */
const config: Config = {
  displayName: 'offline-worker',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
};

export default config;
