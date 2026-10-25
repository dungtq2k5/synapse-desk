import { defineConfig } from '@playwright/test';
import { BROWSER_WS } from './browser-server';
import { WEB_URL } from './ingress';

/**
 * The web client end to end: the whole system started by `test/system`'s own
 * setup, the built web app behind an in-process ingress, Chromium driving it.
 *
 * One worker: the rows share one stack and one seeded tenant, and the
 * gateway's sign-in limit (5 per address per 15 minutes) is cleared before
 * each row, which a parallel row would undo.
 *
 * Two projects. `chromium` runs the journeys in this machine's browser.
 * `screens` (screens/) drives every state of every screen and checks it three
 * ways: what it says, axe in light and dark, and a baseline at 1440 and 390 in
 * light and dark, drawn by the browser in the pinned Playwright image
 * (browser-server.ts). `npm run test:e2e:web:update-screens` rewrites the
 * baselines a change moved.
 */
export default defineConfig({
  testDir: '.',
  // One program for the rows and the system harness they reuse.
  tsconfig: './tsconfig.json',
  testMatch: '**/*.e2e-spec.ts',
  // One baseline per screen, state, width and scheme, beside the rows; no
  // platform suffix, because every baseline is drawn by the same image.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
  },
  // Traces and failure context, beside the rows (git-ignored).
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  // In CI, also JSON: the job lists the rows that passed only on a retry.
  reporter: process.env.CI
    ? [
        ['list'],
        ['junit', { outputFile: 'results.xml' }],
        ['json', { outputFile: 'results.json' }],
      ]
    : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    // The journeys: this machine's Chromium.
    {
      name: 'chromium',
      testIgnore: 'screens/**',
      use: { browserName: 'chromium' },
    },
    // Every state, its look and its accessibility: the browser in the
    // Playwright image (browser-server.ts), so a baseline renders the same on
    // every machine and in CI.
    {
      name: 'screens',
      testMatch: 'screens/**/*.e2e-spec.ts',
      // One retry in CI, for a capture that caught the page mid-render: a
      // real regression fails both attempts and the run stays red, and a row
      // that passes only on its retry is listed as flaky, not hidden. The
      // journeys never retry: they carry the product's behavior. Locally,
      // no retries at all.
      retries: process.env.CI ? 1 : 0,
      use: {
        browserName: 'chromium',
        connectOptions: { wsEndpoint: BROWSER_WS, exposeNetwork: '<loopback>' },
        reducedMotion: 'reduce',
        timezoneId: 'UTC',
        locale: 'en-US',
      },
    },
  ],
});
