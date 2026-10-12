import { defineConfig } from '@playwright/test';
import { WEB_URL } from './ingress';

/**
 * The web client end to end: the whole system started by `test/system`'s own
 * setup, the built web app behind an in-process ingress, Chromium driving it.
 *
 * One worker: the rows share one stack and one seeded tenant, and the
 * gateway's sign-in limit (5 per address per 15 minutes) is cleared before
 * each row, which a parallel row would undo.
 */
export default defineConfig({
  testDir: '.',
  // One program for the rows and the system harness they reuse.
  tsconfig: './tsconfig.json',
  testMatch: '*.e2e-spec.ts',
  // Traces and failure context, beside the rows (git-ignored).
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'results.xml' }]]
    : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
