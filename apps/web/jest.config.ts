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

/**
 * The Markdown renderer and its unified/micromark dependencies ship as ES
 * modules only, so they are compiled like the source, as Next compiles its
 * own client code.
 */
const ESM_ONLY = [
  'react-markdown',
  'unified',
  'bail',
  'ccount',
  'devlop',
  'trough',
  'zwitch',
  'vfile.*',
  'unist-.*',
  'mdast-.*',
  'hast-.*',
  'micromark.*',
  'remark-.*',
  'character-.*',
  'is-(alphabetical|alphanumerical|decimal|hexadecimal|plain-obj)',
  '.*-separated-tokens',
  'decode-named-character-reference',
  'estree-util-.*',
  'html-url-attributes',
  'longest-streak',
  'parse-entities',
  'property-information',
  'stringify-entities',
  'trim-lines',
  '@ungap/structured-clone',
].join('|');

export default async function jestConfig(): Promise<Config> {
  const resolved = await createJestConfig(config)();
  // Next's first pattern names the packages it compiles; these join them.
  const [nextPattern, ...rest] = resolved.transformIgnorePatterns ?? [];
  const compiled = nextPattern?.replace('(?!(geist|', `(?!(geist|${ESM_ONLY}|`);
  if (!compiled || compiled === nextPattern) {
    throw new Error(`Next's transformIgnorePatterns changed: ${nextPattern}`);
  }
  return { ...resolved, transformIgnorePatterns: [compiled, ...rest] };
}
