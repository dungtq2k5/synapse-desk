// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

// `defineConfig` from ESLint core, not `tseslint.config()` — the latter is
// deprecated now that core provides the same thing, and typescript-eslint's
// own docs point here. `tseslint` is still imported: it owns the shared rule
// sets below, and only the wrapper moved.
export default defineConfig(
  {
    ignores: [
      'eslint.config.mjs',
      '**/dist/**',
      '**/node_modules/**',
      // Prisma client output — regenerated from schema.prisma, never hand-edited.
      '**/generated/**',
      // Tooling config, the same class each app's lint glob already omits:
      // jest configs import with the explicit `.ts` extension jest's ESM
      // loading needs, which no lint project parses, and the sequencer is
      // plain CommonJS.
      'test/system/jest*.config.ts',
      // And each workspace's own: a service's config spreads this one, and
      // resolves these patterns from its own folder.
      '**/jest.config.ts',
      // Orval's config is read by Orval (through jiti), not compiled by any
      // tsconfig, so the type-aware rules have no program to read it with.
      'packages/api-client/orval.config.ts',
      '**/jest.e2e.config.ts',
      // Next.js's own generated types and build output.
      'apps/*/.next/**',
      'apps/*/next-env.d.ts',
      'test/system/sequencer.cjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        project: [
          './tsconfig.json',
          './services/*/tsconfig.json',
          './packages/*/tsconfig.json',
          // The clients: each has its own tsconfig (Next.js sets its options).
          './apps/*/tsconfig.json',
          // The demo seeder. `scripts/` is neither an app nor a lib, and the
          // root tsconfig does not include it — without this entry every file
          // under `scripts/seed-demo/` fails to parse with "none of those
          // tsconfigs include this file" rather than being linted.
          './scripts/tsconfig.json',
          // The system harness, for the same reason as `scripts/` above:
          // `test/system/` is neither an app nor a lib, and the root tsconfig
          // does not include it.
          './test/system/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    // `**/*.spec.ts` alone does NOT match `foo.e2e-spec.ts` or
    // `foo.integration-spec.ts` — those end in `-spec.ts`, and the glob wants a
    // literal dot. The `test/**` entry also covers the fixtures and helpers,
    // which are not specs but have exactly the same relationship to these rules.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*-spec.ts', '**/test/**/*.ts'],
    rules: {
      // Assertion libraries are `any` at the boundary by construction:
      // supertest types `res.body` as `any`, and jest's `mock.calls` is
      // `any[][]`. Enforcing these here produces noise on every single
      // assertion rather than catching anything.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // `expect(obj.method)` is the normal way to assert on a spy, and it is
      // not a `this`-scoping mistake.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // The web client: browser code (with the server renderer under src/server/),
    // React's hook rules, and Next.js's own.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      sourceType: 'module',
      // Only the web's own program. With the whole list above, a web file's
      // type information was looked for project by project, building the
      // services' programs on the way: the web lint peaked at 4.8 GB, over
      // Node's default heap, and now at 1.7 GB.
      parserOptions: { project: ['./apps/web/tsconfig.json'] },
    },
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    // The Next.js rules look for the app from the repository root otherwise.
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['apps/web/**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
