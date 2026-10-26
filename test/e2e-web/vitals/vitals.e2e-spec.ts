import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '../coverage';
import { signInAs, tenant } from '../screens/tenant';
import { signInAsSuperAdmin, superAdmin } from '../super-admin';
import { clearThrottles } from '../support';

/**
 * Core Web Vitals on the main screens, from the browser's own performance
 * entries (no library): LCP, CLS, and INP from one interaction per load, the
 * median of three loads, at 1440 and 390 wide. The numbers go to
 * `test-results/web-vitals.json` and the log, and **every screen is gated**
 * on {@link LIMITS}: CLS and INP at Google's "good", LCP at 1 s rather than
 * its 2.5 s, so a slowdown fails long before people feel it (the CI runner's
 * worst LCP was 428 ms, varying about ±30% between runs).
 *
 * Never on the coverage build: its source maps and V8 coverage slow every page.
 */
test.skip(
  Boolean(process.env.WEB_COVERAGE_DIR),
  'the coverage build is instrumented; vitals run on the plain build',
);
test.beforeEach(clearThrottles);

/** The most each vital may be, on every screen: ms, a score, ms. */
const LIMITS = { lcp: 1000, cls: 0.1, inp: 200 } as const;

type Vitals = { lcp: number; cls: number; inp: number; shifted: string[] };

/** Observes LCP, CLS and every interaction's duration from the first paint. */
const OBSERVE = () => {
  const vitals: Vitals = { lcp: 0, cls: 0, inp: 0, shifted: [] };
  (globalThis as unknown as { __vitals: Vitals }).__vitals = vitals;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources?: {
        node?: Node | null;
        previousRect: DOMRectReadOnly;
        currentRect: DOMRectReadOnly;
      }[];
    })[]) {
      if (entry.hadRecentInput) continue;
      vitals.cls += entry.value;
      // What moved, for the report: a shift over budget needs its element.
      for (const { node, previousRect, currentRect } of entry.sources ?? []) {
        if (!(node instanceof Element)) continue;
        const moved = `y ${Math.round(previousRect.y)}→${Math.round(currentRect.y)}, h ${Math.round(previousRect.height)}→${Math.round(currentRect.height)}`;
        const label = `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}.${[...node.classList].slice(0, 3).join('.')} (${entry.value.toFixed(3)}; ${moved})`;
        if (!vitals.shifted.includes(label)) vitals.shifted.push(label);
      }
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & {
      interactionId: number;
    })[]) {
      if (entry.interactionId)
        vitals.inp = Math.max(vitals.inp, entry.duration);
    }
  }).observe({
    type: 'event',
    buffered: true,
    durationThreshold: 16,
  } as PerformanceObserverInit);
};

type Screen = { name: string; path: string };

/**
 * One interaction per load, the same on every screen and at both widths: a
 * click on the page's heading (a click counts towards INP wherever it lands).
 */
const clickHeading = (page: Page) => page.locator('h1').first().click();

async function measure(page: Page, screen: Screen): Promise<Vitals> {
  await page.goto(screen.path);
  await page.waitForLoadState('networkidle');
  await clickHeading(page);
  await page.waitForTimeout(500);
  return page.evaluate(
    () => (globalThis as unknown as { __vitals: Vitals }).__vitals,
  );
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('Core Web Vitals on the main screens, median of three, at 1440 and 390', async ({
  page,
}) => {
  test.setTimeout(900_000);
  await page.addInitScript(OBSERVE);
  const { maya, tickets } = await tenant('vitals');
  const screens: (Screen & { as: 'none' | 'maya' | 'super' })[] = [
    {
      name: 'sign-in',
      path: '/login',
      as: 'none',
    },
    {
      name: 'ticket list',
      path: '/tickets',
      as: 'maya',
    },
    {
      name: 'a ticket',
      path: `/tickets/${tickets.mobile}`,
      as: 'maya',
    },
    { name: 'Ask', path: '/ask', as: 'maya' },
    {
      name: 'knowledge documents',
      path: '/knowledge/documents',
      as: 'maya',
    },
    {
      name: 'Settings people',
      path: '/settings/people',
      as: 'maya',
    },
    {
      name: 'analytics overview',
      path: '/analytics',
      as: 'maya',
    },
    {
      name: 'platform overview',
      path: '/platform',
      as: 'super',
    },
  ];
  const admin = await superAdmin('vitals');

  const report: (Vitals & { screen: string; width: number })[] = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of screens) {
      await page.context().clearCookies();
      if (screen.as === 'maya') await signInAs(page, maya);
      if (screen.as === 'super') await signInAsSuperAdmin(page, admin);
      const runs: Vitals[] = [];
      for (let load = 0; load < 3; load++)
        runs.push(await measure(page, screen));
      report.push({
        screen: screen.name,
        width,
        lcp: Math.round(median(runs.map((run) => run.lcp))),
        cls: Number(median(runs.map((run) => run.cls)).toFixed(3)),
        inp: Math.round(median(runs.map((run) => run.inp))),
        shifted: runs[0].shifted.slice(0, 5),
      });
    }
  }

  const out = join(__dirname, '..', 'test-results');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'web-vitals.json'), JSON.stringify(report, null, 2));
  const mark = (good: boolean) => (good ? 'good' : 'OVER');
  console.log(
    report
      .map(
        (row) =>
          `${row.screen.padEnd(20)} ${String(row.width).padStart(4)}  LCP ${String(row.lcp).padStart(5)} ms ${mark(row.lcp <= LIMITS.lcp)}  CLS ${row.cls.toFixed(3)} ${mark(row.cls <= LIMITS.cls)}  INP ${String(row.inp).padStart(4)} ms ${mark(row.inp <= LIMITS.inp)}${row.cls > LIMITS.cls ? `\n    shifted: ${row.shifted.join(', ')}` : ''}`,
      )
      .join('\n'),
  );
  // A measurement that read nothing is a broken observer, not a fast page.
  expect(report.every((row) => row.lcp > 0)).toBe(true);
  // Every vital over its limit, named; a shift with what moved.
  expect(
    report.flatMap((row) => {
      const at = `${row.screen} ${row.width}`;
      return [
        ...(row.lcp > LIMITS.lcp ? [`${at}: LCP ${row.lcp} ms`] : []),
        ...(row.cls > LIMITS.cls
          ? [`${at}: CLS ${row.cls} ${row.shifted.join(', ')}`]
          : []),
        ...(row.inp > LIMITS.inp ? [`${at}: INP ${row.inp} ms`] : []),
      ];
    }),
  ).toEqual([]);
});
