import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

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
  } = {},
): Promise<void> {
  const initial = page.viewportSize();
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await accessible(page, options.disabled ?? []);
    for (const { name: width, ...size } of WIDTHS.filter(
      ({ name: each }) => !options.widths || options.widths.includes(each),
    )) {
      await page.setViewportSize(size);
      // No sideways scroll: nothing reaches past the viewport, at any width.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${name} at ${width} is wider than the viewport`,
      ).toBeLessThanOrEqual(size.width);
      await normalize(page);
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
  await page.emulateMedia({ colorScheme: 'light' });
  if (initial) await page.setViewportSize(initial);
}

/**
 * Gives what varies the same text on every run, so a masked box is the same
 * width and nothing after it moves: times, ticket numbers and the run's email
 * addresses. Run before each screenshot, since a resize can re-render them.
 */
async function normalize(page: Page): Promise<void> {
  await page.evaluate(() => {
    // A ticket number is "#" and its digits, often as two text nodes.
    for (const element of document.querySelectorAll('body *')) {
      if (
        element.children.length === 0 &&
        /^#\d+$/.test(element.textContent?.trim() ?? '')
      ) {
        element.textContent = '#0000';
      }
    }
    // A read-only field shows an address too (the profile's email).
    for (const input of document.querySelectorAll('input')) {
      if (/@[\w.-]+\.example\.test$/.test(input.value)) {
        input.value = 'person@northwind.example.test';
        // Chrome can keep a glyph of the longer address painted; take the
        // field out of the layout and back so it's drawn afresh.
        input.style.display = 'none';
        void input.offsetHeight;
        input.style.display = '';
      }
    }
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';
      if (node.parentElement?.closest('time')) node.nodeValue = '00:00';
      else if (/#\d+/.test(text)) {
        node.nodeValue = text.replace(/#\d+/g, '#0000');
      } else if (/@[\w.-]+\.example\.test/.test(text)) {
        node.nodeValue = text.replace(
          /[\w.-]+@[\w.-]+\.example\.test/,
          'person@northwind.example.test',
        );
      }
    }
  });
}

/** No `serious` or `critical` axe violation on the page as it is now. */
export async function accessible(
  page: Page,
  disabled: string[] = [],
): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .disableRules(disabled)
    .analyze();
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
