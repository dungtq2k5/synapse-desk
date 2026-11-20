import type { Page } from '@playwright/test';

/** A moment the document didn't have exactly one `<title>`. */
export type TitleFault = {
  at: number;
  titles: number;
  texts: string[];
  url: string;
};

type Watched = Window & { titleFaults?: TitleFault[] };

/**
 * Watches the document's `<title>` from load, as an init script: after each
 * batch of DOM mutations, a document that has had its title and now has none,
 * or two, is recorded with the time and the address.
 *
 * After each batch, not each record: a navigation's remove-then-insert lands in
 * one batch and never shows. A gap that outlasts a batch is a moment a screen
 * reader announces the page by nothing, however short. An SVG's `<title>` is
 * its own, not the document's, and isn't counted. A full page load starts a
 * new document and a new record.
 *
 * @example await context.addInitScript(watchTitle);
 */
export function watchTitle(): void {
  const faults: TitleFault[] = [];
  (window as Watched).titleFaults = faults;
  let armed = false;
  const check = () => {
    const found = [...document.querySelectorAll('title')].filter(
      (title) => !title.closest('svg'),
    );
    const titles = found.length;
    if (titles === 1) {
      armed = true;
      return;
    }
    if (armed) {
      faults.push({
        at: Math.round(performance.now()),
        titles,
        texts: found.map((title) => title.textContent ?? ''),
        url: location.pathname + location.search,
      });
    }
  };
  new MutationObserver(check).observe(document, {
    childList: true,
    subtree: true,
  });
}

/** What {@link watchTitle} recorded in the page's current document. */
export async function titleFaults(page: Page): Promise<string[]> {
  const faults = await page.evaluate(
    () => (window as Watched).titleFaults ?? [],
  );
  return faults.map(
    ({ at, titles, texts, url }) =>
      `${titles === 0 ? 'no <title>' : `${titles} <title>s (${texts.map((text) => JSON.stringify(text)).join(', ')})`} at ${at} ms, on ${url}`,
  );
}
