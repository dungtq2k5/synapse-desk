import type { Config } from 'jest';

/**
 * The suite's own helpers, unit-tested: no stack, no browser server, a jsdom
 * page. Registered in the root `--projects`, so `npm test` carries it. A
 * `*.e2e-spec.ts` row never matches: it ends in `-spec.ts`, not `.spec.ts`.
 */
const config: Config = {
  displayName: 'e2e-web:unit',
  rootDir: '.',
  testEnvironment: 'jsdom',
  testRegex: String.raw`test/e2e-web/.*\.spec\.ts$`,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};

export default config;
