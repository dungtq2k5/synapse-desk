import { expect, test, type Page } from './coverage';
import { signInInPopup } from './firebase';
import { signInAs, tenant } from './screens/tenant';
import { signInAsSuperAdmin, superAdmin } from './super-admin';
import { clearThrottles } from './support';

/**
 * The landing page at `/`: what a visitor sees, and that nobody
 * signed in ever does. Pricing reads the seeded catalog through the public
 * plan read.
 */
test.beforeEach(clearThrottles);

const HEADLINE = 'Support that answers from your own documents';

const headline = (page: Page) =>
  page.getByRole('heading', { level: 1, name: HEADLINE });

test.describe('who sees it', () => {
  test('signed out: `/` answers 200 with the h1 in the server HTML', async ({
    request,
  }) => {
    const response = await request.get('/', { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    const html = await response.text();
    // The server's own HTML, before any script: the largest paint is the words.
    expect(html).toMatch(new RegExp(`<h1[^>]*>${HEADLINE}</h1>`));
    expect(html).toContain('aria-hidden="true"');
  });

  test('signed in: an agent lands on Tickets, a requester on Ask, a Super Admin on the console', async ({
    browser,
  }) => {
    const { maya, priya } = await tenant('landing-roles');
    const admin = await superAdmin(`landing-${Date.now()}`);

    for (const [sign, path] of [
      [(page: Page) => signInAs(page, maya), /\/tickets$/],
      [(page: Page) => signInAs(page, priya), /\/ask$/],
      [(page: Page) => signInAsSuperAdmin(page, admin), /\/platform$/],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await sign(page);
      await page.goto('/');
      await expect(page).toHaveURL(path);
      await expect(headline(page)).toHaveCount(0);
      await context.close();
    }
  });

  test('an expired access cookie with a live refresh cookie still lands in the app', async ({
    page,
    context,
  }) => {
    const { maya } = await tenant('landing-refresh');
    await signInAs(page, maya);
    await context.clearCookies({ name: 'access_token' });

    await page.goto('/');

    await expect(page).toHaveURL(/\/tickets$/);
    await expect(headline(page)).toHaveCount(0);
  });

  test('an access cookie the gateway refuses, and no refresh cookie: the landing page', async ({
    page,
    context,
  }) => {
    // Nothing can renew it, so this is a visitor, not an expired session.
    await page.goto('/');
    await context.addCookies([
      { name: 'access_token', value: 'not-a-token', url: page.url() },
    ]);

    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(headline(page)).toBeVisible();
  });
});

test.describe('the page', () => {
  test('each section link puts its heading below the sticky header', async ({
    page,
  }) => {
    await page.goto('/');
    const header = page.locator('header').first();

    for (const [link, heading] of [
      ['How it works', 'How it works'],
      ['Pricing', 'Pricing'],
    ]) {
      await page
        .getByRole('navigation', { name: 'Sections' })
        .getByRole('link', { name: link })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`#${link === 'Pricing' ? 'pricing' : 'how-it-works'}$`),
      );
      const target = page.getByRole('heading', { level: 2, name: heading });
      await expect
        .poll(async () => {
          const headerBox = await header.boundingBox();
          const headingBox = await target.boundingBox();
          return headingBox && headerBox
            ? headingBox.y >= headerBox.y + headerBox.height
            : false;
        })
        .toBe(true);
    }
  });

  test('the menu at 390: Escape closes it, and focus goes back to its button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Menu' });

    await button.click();
    const close = page.getByRole('button', { name: 'Close menu' });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'Pricing' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('link', { name: 'Pricing' })).toBeHidden();
  });

  test('the flow graph: focusing a step highlights it and shows its sentence', async ({
    page,
  }) => {
    await page.goto('/');
    const steps = page.getByRole('list').filter({ hasText: '1. Someone asks' });
    const second = steps.getByRole('listitem').nth(1);
    const sentence = second.getByText(
      'It answers from your organization’s documents and shows the passages it used.',
    );
    await expect(sentence).toHaveCSS('opacity', '0');

    await second.focus();

    await expect(second).toHaveAttribute('data-active', 'true');
    await expect(sentence).toHaveCSS('opacity', '1');
  });

  test('pricing: Free first, the seeded plans in Billing’s formatting, Yearly swaps them, no plan without a price', async ({
    page,
  }) => {
    await page.goto('/');
    const pricing = page.locator('#pricing');
    const cards = pricing.getByRole('region');
    await expect(cards.first()).toHaveAccessibleName('Free');
    await expect(cards.first()).toContainText('No card needed');

    const pro = pricing.getByRole('region', { name: 'Pro', exact: true });
    await expect(pro).toContainText('$99.00');
    await expect(pro).toContainText('per month');
    await expect(
      pricing.getByRole('region', { name: 'Starter', exact: true }),
    ).toContainText('$29.00');
    await expect(
      pricing.getByRole('region', { name: 'Enterprise', exact: true }),
    ).toContainText('$499.00');
    // Every card but Free carries a price: no negotiated plan, no "—".
    await expect(pricing.getByText('—', { exact: true })).toHaveCount(0);

    await pricing.getByRole('radio', { name: 'Yearly' }).click();

    await expect(pro).toContainText('$990.00');
    await expect(pro).toContainText('per year');
    await expect(pro.getByRole('link', { name: 'Choose Pro' })).toHaveAttribute(
      'href',
      /^\/sign-up\?next=%2Fsettings%2Fbilling%3Fchoose%3D/,
    );
  });

  test('Choose Pro through Google sign-up lands on Billing with Pro picked out', async ({
    page,
  }) => {
    const email = `founder@landing-${Date.now()}.example.test`;
    await page.goto('/');
    await page
      .locator('#pricing')
      .getByRole('link', { name: 'Choose Pro' })
      .click();
    await expect(page).toHaveURL(/\/sign-up\?next=/);

    const opened = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    // A new domain: the founder is its admin, so Billing lets them choose.
    await signInInPopup(await opened, email, 'Fran Okafor');

    // The parameter is dropped once read, and Pro's button has focus.
    await expect(page).toHaveURL(/\/settings\/billing$/);
    await expect(
      page.getByRole('button', { name: 'Choose Pro' }),
    ).toBeFocused();
  });
});

test.describe('the return path’s label', () => {
  /** The label against the arc: its box, the arc's peak, and any arc point inside the box. */
  const measure = (page: Page) =>
    page.evaluate(() => {
      const label = [...document.querySelectorAll('#how-it-works p')].find(
        (p) => p.textContent === 'The next answer uses what was fixed',
      )!;
      const arc = [...document.querySelectorAll('#how-it-works path')].find(
        (path) => path.getAttribute('stroke-dasharray'),
      ) as SVGPathElement;
      const box = label.getBoundingClientRect();
      const shown = (element: Element) =>
        getComputedStyle(element).display !== 'none' &&
        getComputedStyle(element.closest('svg') ?? element).display !== 'none';
      if (!shown(label) || !shown(arc)) {
        return { drawn: false, peak: 0, top: 0, touching: 0 };
      }
      const matrix = arc.getScreenCTM()!;
      const length = arc.getTotalLength();
      const points = Array.from({ length: 400 }, (_, index) => {
        const { x, y } = arc.getPointAtLength((index / 399) * length);
        return new DOMPoint(x, y).matrixTransform(matrix);
      });
      return {
        drawn: true,
        peak: Math.min(...points.map((point) => point.y)),
        top: box.top,
        // A stroke 1.5 wide: a point within 1 px of the box touches it.
        touching: points.filter(
          (point) =>
            point.x >= box.left - 1 &&
            point.x <= box.right + 1 &&
            point.y >= box.top - 1 &&
            point.y <= box.bottom + 1,
        ).length,
      };
    });

  test('at 1440 it sits under the arc’s peak, clear of the arc; at 200% text the graph is the rail', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.locator('#how-it-works').scrollIntoViewIfNeeded();

    const normal = await measure(page);
    expect(normal.drawn).toBe(true);
    expect(normal.top).toBeGreaterThan(normal.peak);
    expect(normal.touching).toBe(0);

    // Text at 200%: the default font size, as a person sets it. The rem
    // breakpoints move with it, so a 1440 window gets the rail, where the
    // return path is a sentence under the steps and no arc is drawn.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', {
      fontSizes: { standard: 32, fixed: 26 },
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        ),
      )
      .toBe('32px');
    const doubled = await measure(page);
    expect(doubled.drawn ? doubled.touching : 0).toBe(0);
    expect(doubled.drawn).toBe(false);
    await expect(
      page.getByText(
        'Then back to step 2: the next answer uses what was fixed.',
      ),
    ).toBeVisible();
    await cdp.send('Page.setFontSizes', {
      fontSizes: { standard: 16, fixed: 13 },
    });
    await cdp.detach();
  });
});

test.describe('the scene', () => {
  test('reduced motion: no canvas and no flow light in the DOM', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('load');
    await expect(headline(page)).toBeVisible();

    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('#how-it-works animateMotion')).toHaveCount(0);
  });

  test('at 1440 with motion allowed: the canvas mounts after load and the still fades', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // The device checks, met: a desktop with a fine pointer and enough cores.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
    });
    await page.goto('/');
    await page.waitForLoadState('load');

    // The canvas drew its first frame (the still) under the image, then the
    // image's wrapper faded out.
    await expect(page.locator('#hero canvas')).toHaveCount(1);
    await expect(page.locator('#hero canvas + div')).toHaveCSS('opacity', '0');
  });

  test('with WebGL off: the still stays and the console is clean', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(message.text());
      }
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === 'webgl2') return null;
        return (real as (...args: unknown[]) => unknown).call(
          this,
          kind,
          ...rest,
        );
      } as typeof real;
    });
    await page.goto('/');
    await page.waitForLoadState('load');

    // The loader tried, failed quietly, and took the canvas away again.
    await expect(page.locator('#hero canvas')).toHaveCount(0);
    await expect(page.locator('#hero svg').first()).toBeVisible();
    expect(problems).toEqual([]);
  });
});
