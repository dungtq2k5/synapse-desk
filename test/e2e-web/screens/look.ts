import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { keepNormalized, stopNormalizing } from './normalize';

/** The two widths every state is drawn at: a laptop, and a phone. */
const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

/**
 * What changes from run to run and is masked in every baseline: times (the
 * data is written as the run starts), ticket numbers (one sequence for the
 * whole system, so every run's tickets get new ones) and the screen tenants'
 * email addresses (a domain per run). A row adds its own.
 */
function variable(page: Page): Locator[] {
  return [
    page.locator('time'),
    page.getByText(/^#\d+$/),
    page.getByText(/@[\w.-]+\.example\.test$/),
    // The bell's count: the tenant's own notifications land as the services
    // get to them. The bell's rows assert it by the bell's name.
    page.locator('[data-notification-count]'),
  ];
}

/**
 * Checks a state the row has driven the page into, then draws it: axe in light
 * and dark, then a baseline at each width in each scheme. The page is resized
 * and re-themed in place, so every variant is the same state.
 *
 * Axe fails on a `serious` or `critical` violation, color contrast included.
 * `disabled` names the rules a row turns off, each with its reason beside the
 * call; nothing is disabled globally.
 *
 * @example await look(page, 'sign-in');
 */
export async function look(
  page: Page,
  name: string,
  options: {
    mask?: Locator[];
    disabled?: string[];
    target?: Locator;
    /** A state that exists at one width only, such as the phone's menu sheet. */
    widths?: ('desktop' | 'phone')[];
    /**
     * The viewport rather than the whole page: for a toast, which is fixed to
     * the viewport and moves when a full-page capture resizes it.
     */
    viewportOnly?: boolean;
    /**
     * The row paused the page's clock to hold a state on a timer (a "Copied"
     * that reverts): axe gets the clock moved on only as far as it needs.
     */
    heldClock?: boolean;
  } = {},
): Promise<void> {
  const initial = page.viewportSize();
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await accessible(page, options.disabled ?? [], options.heldClock);
    for (const { name: width, ...size } of WIDTHS.filter(
      ({ name: each }) => !options.widths || options.widths.includes(each),
    )) {
      await page.setViewportSize(size);
      // No sideways scroll: nothing reaches past the viewport, at any width.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${name} at ${width} is wider than the viewport`,
      ).toBeLessThanOrEqual(size.width);
      await page.evaluate(keepNormalized);
      // From the top: a full-page capture draws the fixed sidebar wherever the
      // scroll left it, and focus (an escalation notice) scrolls by timing.
      await page.evaluate(() => window.scrollTo(0, 0));
      const mask = [...variable(page), ...(options.mask ?? [])];
      const file = `${name}-${width}-${scheme}.png`;
      if (options.target) {
        await expect(options.target).toHaveScreenshot(file, { mask });
      } else {
        await expect(page).toHaveScreenshot(file, {
          mask,
          fullPage: !options.viewportOnly,
        });
      }
    }
  }
  await page.evaluate(stopNormalizing);
  await page.emulateMedia({ colorScheme: 'light' });
  if (initial) await page.setViewportSize(initial);
}

/**
 * A Radix menu, dialog or listbox still playing its exit: it keeps the rest of
 * the page `aria-hidden` until it unmounts, so axe run now reports the page's
 * own controls as hidden and focusable.
 */
const CLOSING_LAYER =
  ':is([role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"])[data-state="closed"]';

/**
 * No `serious` or `critical` axe violation on the page as it is now, once any
 * layer that is closing has gone.
 */
export async function accessible(
  page: Page,
  disabled: string[] = [],
  heldClock = false,
): Promise<void> {
  await expect(page.locator(CLOSING_LAYER)).toHaveCount(0);
  const run = new AxeBuilder({ page }).disableRules(disabled).analyze();
  // Axe waits on the page's timers, so a paused clock would hang it: move it
  // on a millisecond at a time until axe is done (about 15 ms a pass). The
  // clock is the context's, so a tick can land as axe closes its own helper
  // page and fail; `run` still says how axe went.
  let done = false;
  const settle = () => {
    done = true;
  };
  void run.then(settle, settle);
  while (heldClock && !done) {
    await page.clock.runFor(1).catch(() => undefined);
  }
  const { violations } = await run;
  expect(
    violations
      .filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ id, help, nodes }) => ({
        id,
        help,
        targets: nodes.map((node) => node.target.join(' ')),
      })),
  ).toEqual([]);
}

/**
 * Tab from where focus is now, asserting each stop by its accessible name in
 * order: a screen's focus order, as its accessibility notes give it.
 */
export async function tabsThrough(page: Page, stops: RegExp[]): Promise<void> {
  for (const stop of stops) {
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAccessibleName(stop);
  }
}
