import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, type Page } from '@playwright/test';

export * from '@playwright/test';

/**
 * Playwright's `test`, recording the browser's V8 coverage when
 * `WEB_COVERAGE_DIR` is set: every page each row's context opens, written as
 * raw JSON under `<dir>/browser/` when the row ends. `coverage-report.ts`
 * maps it back to the sources. Rows import `test` from here rather than from
 * `@playwright/test`; without the variable it adds nothing.
 *
 * A page the row closed itself is lost: Chromium hands its coverage back only
 * while it's open.
 */
export const test = base.extend<{ coverage: undefined }>({
  coverage: [
    async ({ context }, use, testInfo) => {
      const dir = process.env.WEB_COVERAGE_DIR;
      if (!dir) {
        await use(undefined);
        return;
      }
      const started = new Map<Page, Promise<void>>();
      const start = (page: Page) => {
        started.set(
          page,
          page.coverage.startJSCoverage({ resetOnNavigation: false }),
        );
      };
      context.pages().forEach(start);
      context.on('page', start);

      await use(undefined);

      const out = join(dir, 'browser');
      mkdirSync(out, { recursive: true });
      let index = 0;
      for (const [page, ready] of started) {
        await ready.catch(() => undefined);
        if (page.isClosed()) continue;
        const entries = await page.coverage.stopJSCoverage().catch(() => []);
        const ours = entries
          .filter((entry) => entry.url.includes('/_next/static/'))
          .map(({ url, functions }) => ({ url, functions }));
        if (ours.length === 0) continue;
        writeFileSync(
          join(out, `${testInfo.testId}-${testInfo.retry}-${index++}.json`),
          JSON.stringify(ours),
        );
      }
    },
    { auto: true },
  ],
});
