import { expect, type Page } from '../coverage';

/**
 * Holds the button rule on every visible closing row on the page
 * (`data-slot="closing-actions"`): its last item on the right edge of the card
 * it closes at 1440, its first item on the left edge at 390. Measured against
 * the card's content box (or the row's parent outside a card), so a row
 * narrower than its card fails too. An empty item (a status line with nothing
 * to say) doesn't count.
 */
export async function expectClosingRows(page: Page): Promise<void> {
  const rows = page.locator('[data-slot="closing-actions"]');
  await expect(rows.first()).toBeVisible();
  const edges = () =>
    rows.evaluateAll((elements) =>
      elements
        .filter((row) => row.getBoundingClientRect().width > 0)
        .map((row) => {
          const container =
            row.closest('[data-slot="card-content"]') ?? row.parentElement!;
          const outer = container.getBoundingClientRect();
          const style = getComputedStyle(container);
          const inset = (side: 'Left' | 'Right') =>
            Number.parseFloat(style[`padding${side}`]) +
            Number.parseFloat(style[`border${side}Width`]);
          const box = {
            left: outer.left + inset('Left'),
            right: outer.right - inset('Right'),
          };
          const items = [...row.children]
            .map((item) => item.getBoundingClientRect())
            .filter((item) => item.width > 0);
          return {
            left: Math.round(items[0].left - box.left),
            right: Math.round(box.right - items.at(-1)!.right),
          };
        }),
    );

  // Polled: the page reflows for a moment after the viewport changes.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(async () => (await edges()).every((e) => e.right === 0))
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await edges()).every((e) => e.left === 0))
    .toBe(true);
}
