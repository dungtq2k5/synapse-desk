import type { Config } from 'jest';
import nextJest from 'next/jest.js';

/**
 * The web's tests, compiled by Next's own SWC setup, so a test sees the code
 * the build sees. Components run in jsdom; a `*.spec.ts` under `src/server/`
 * sets `@jest-environment node` itself where it needs the server's globals.
 */
const createJestConfig = nextJest({ dir: import.meta.dirname });

const config: Config = {
  displayName: 'web',
  testEnvironment: 'jsdom',
  testRegex: String.raw`\.spec\.tsx?$`,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // See src/test/firebase.ts.
    '^firebase/(app|auth)$': '<rootDir>/src/test/firebase.ts',
  },
  // The standalone build carries its own copy of this package's manifest.
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
};

export default createJestConfig(config);
