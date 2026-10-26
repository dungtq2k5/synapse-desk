import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Keyboard-only journeys: reach every control with Tab, never the mouse, and
 * see where focus is at every stop.
 */

/** The most Tab presses a control may be away before it counts as unreachable. */
const MAX_PRESSES = 120;

/**
 * Presses Tab, then Shift+Tab, until `target` has focus, checking the
 * focus shows at that stop. Fails, naming the control, if it can't be
 * reached: a control only a mouse can use.
 *
 * A control in a `toolbar` is reached as a toolbar's are: Tab to the
 * toolbar's one stop, then the arrow keys along it.
 *
 * @example await tabTo(page, page.getByRole('button', { name: 'Send reply' }))
 */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const focused = () =>
    target.evaluate((element) => element === document.activeElement);
  const inToolbar = await target.evaluate(
    (element) => element.closest('[role="toolbar"]') !== null,
  );
  const atStop = inToolbar
    ? () =>
        target.evaluate(
          (element) =>
            element
              .closest('[role="toolbar"]')
              ?.contains(document.activeElement) ?? false,
        )
    : focused;

  // Forward first, then back: a control before the focus is nearer that way.
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let presses = 0; presses <= MAX_PRESSES; presses++) {
      if (await atStop()) {
        for (let arrows = 0; inToolbar && arrows <= 20; arrows++) {
          if (await focused()) break;
          await page.keyboard.press('ArrowRight');
        }
        if (!(await focused())) break;
        await expectFocusVisible(page);
        return;
      }
      await page.keyboard.press(key);
    }
  }
  throw new Error(
    `Not reachable by keyboard in ${MAX_PRESSES} presses either way: ${target.toString()}`,
  );
}

/** Tabs to `target` and presses `key` on it (Enter by default). */
export async function pressOn(
  page: Page,
  target: Locator,
  key = 'Enter',
): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press(key);
}

/** Tabs to a text field and types into it. */
export async function typeInto(
  page: Page,
  field: Locator,
  text: string,
): Promise<void> {
  await tabTo(page, field);
  await page.keyboard.type(text);
}

/**
 * The focused control shows its focus: an outline or a ring on it, its
 * `::after`, or the field around it (an input inside a styled box draws its
 * ring there); a code field's active slot.
 */
export async function expectFocusVisible(page: Page): Promise<void> {
  // Polled: a ring that transitions in reads `none` at its first frame.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          if (!active || active === document.body) return false;
          // A code field draws its ring on the active slot beside the input.
          if (active.hasAttribute('data-input-otp')) {
            return (
              active
                .closest('[data-input-otp-container]')
                ?.querySelector('[data-active="true"]') != null
            );
          }
          const shows = (element: Element, pseudo?: string) => {
            const style = getComputedStyle(element, pseudo);
            const outline =
              style.outlineStyle !== 'none' &&
              Number.parseFloat(style.outlineWidth) > 0;
            return outline || style.boxShadow !== 'none';
          };
          let element: HTMLElement | null = active;
          for (let level = 0; element && level < 3; level++) {
            // A row-wide link draws its ring on `::after`.
            if (shows(element) || shows(element, '::after')) return true;
            element = element.parentElement;
          }
          return false;
        }),
      { message: 'the focused control shows its focus', timeout: 2_000 },
    )
    .toBe(true);
}

/** Focus is on `target`: where it should land after a dialog closes. */
export async function expectFocusOn(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
}

/**
 * In an open menu, moves with ArrowDown to the item named `name` and picks it
 * with Enter.
 */
export async function chooseMenuItem(page: Page, name: string): Promise<void> {
  const item = page.getByRole('menuitem', { name });
  await expect(item).toBeVisible();
  for (let presses = 0; presses <= 30; presses++) {
    if (await item.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`Menu item not reachable with the arrow keys: ${name}`);
}
