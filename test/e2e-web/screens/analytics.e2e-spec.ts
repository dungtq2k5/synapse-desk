import type { Route } from '@playwright/test';
import { expect, test, type Page } from '../coverage';
import {
  AGENTS,
  AI_USAGE,
  DOCUMENTS,
  EMPTY,
  FEEDBACK_PAGE,
  FROM,
  GAPS,
  OVERVIEW,
  PREVIOUS,
  RANGE,
  series,
} from '../../../apps/web/src/test/analytics-data';
import { look } from './look';
import { failed, hang, ok, settings, type Overrides } from './settings-data';
import {
  giveOnly,
  setAnalyticsRange,
  signInAs,
  tenant,
  type Person,
  type Tenant,
} from './tenant';

/**
 * Analytics (design 10): every state of the matrix, each checked by what it
 * says, axe and a baseline. The analytics calls are answered here, so the
 * handoff's sample is on every run; the viewer is real. The clock stands at
 * 19 Oct 2026, the sample's last day, as the handoff draws it.
 */

const granularity = (route: Route) =>
  new URL(route.request().url()).searchParams.get('granularity') ?? 'DAY';

/** The overview answers the window it's asked for: the sample, or the one before. */
const overview =
  (now = OVERVIEW, before = PREVIOUS) =>
  (route: Route) =>
    route.fulfill(
      ok(
        new URL(route.request().url()).searchParams.get('from') === FROM
          ? now
          : before,
      ),
    );

const grouped =
  (pick: (by: ReturnType<typeof series>) => unknown) => (route: Route) =>
    route.fulfill(ok(pick(series(granularity(route)))));

const ANALYTICS: Overrides = {
  'GET /analytics/overview': overview(),
  'GET /analytics/volume': grouped((s) => s.volume),
  'GET /analytics/deflection': grouped((s) => s.deflection),
  'GET /analytics/satisfaction': grouped((s) => s.satisfaction),
  'GET /analytics/response-times': grouped((s) => s.responseTimes),
  'GET /analytics/agents': ok(AGENTS),
  'GET /analytics/knowledge-gaps': ok(GAPS),
  'GET /analytics/documents': ok(DOCUMENTS),
  'GET /analytics/ai-usage': ok(AI_USAGE),
  'GET /feedback': ok(FEEDBACK_PAGE),
};

/** Every time series answering with the days through `day` only. */
const through = (day: string | null): Overrides => {
  const answer =
    (pick: (by: ReturnType<typeof series>) => { points: { day: string }[] }) =>
    (route: Route) => {
      const answer = pick(series(granularity(route)));
      return route.fulfill(
        ok({
          ...answer,
          points:
            day === null
              ? []
              : answer.points.filter((point) => point.day <= day),
          dataThrough: day,
        }),
      );
    };
  return {
    'GET /analytics/overview': overview({ ...OVERVIEW, dataThrough: day }),
    'GET /analytics/volume': answer((s) => s.volume),
    'GET /analytics/deflection': answer((s) => s.deflection),
    'GET /analytics/satisfaction': answer((s) => s.satisfaction),
    'GET /analytics/response-times': answer((s) => s.responseTimes),
  };
};

const NOTHING = {
  items: [],
  meta: { ...FEEDBACK_PAGE.meta, totalItems: 0, itemCount: 0, totalPages: 0 },
};

async function open(
  page: Page,
  path: string,
  heading: string | null,
  overrides: Overrides = {},
  options: {
    as?: (found: Tenant) => Person;
    query?: string;
    tenant?: string;
  } = {},
) {
  await page.clock.setFixedTime(new Date('2026-10-19T18:00:00'));
  const found = await tenant(options.tenant ?? 'analytics');
  const person = options.as ? options.as(found) : found.maya;
  await signInAs(page, person);
  await settings(page, person.id, { ...ANALYTICS, ...overrides });
  await page.goto(`${path}?${options.query ?? RANGE}`);
  if (heading) {
    await expect(
      page.getByRole('heading', { name: heading, level: 1 }),
    ).toBeVisible();
  }
}

const pickerButton = (page: Page) =>
  page.getByRole('button', { name: /20 Sept – 19 Oct 2026 · 30 days/ });

test.describe('Overview', () => {
  test('a busy organization, last 30 days, by day', async ({ page }) => {
    await open(page, '/analytics', 'Overview');
    await expect(page.getByText('Data through 19 Oct 2026')).toBeVisible();
    await expect(page.getByText('+6% vs the previous 30 days')).toBeVisible();
    await expect(
      page.getByText(
        /^Over 30 days: 415 created, 397 resolved, 63 escalated\./,
      ),
    ).toBeVisible();
    await look(page, 'analytics-overview');
  });

  test('by week, one department', async ({ page }) => {
    await open(
      page,
      '/analytics',
      'Overview',
      {},
      {
        query: `${RANGE}&department=it&by=week`,
      },
    );
    await expect(page.getByRole('combobox', { name: 'Department' })).toHaveText(
      'IT support',
    );
    await expect(
      page.getByText(/The last week holds only 19 Oct, so it’s dashed\./),
    ).toBeVisible();
    await look(page, 'analytics-overview-week');
  });

  test('a day focused by keyboard: Volume’s tooltip', async ({ page }) => {
    await open(page, '/analytics', 'Overview');
    const plot = page.getByRole('group', { name: /^Volume\./ });
    await plot.focus();
    for (let step = 0; step < 17; step++) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(plot.getByText('6 Oct 2026')).toBeVisible();
    await look(page, 'analytics-overview-tooltip', { viewportOnly: true });
  });

  test('Volume switched to its table', async ({ page }) => {
    await open(page, '/analytics', 'Overview');
    await page
      .getByRole('radiogroup', { name: 'View volume as' })
      .getByRole('radio', { name: 'Table' })
      .click();
    const table = page.getByRole('region', { name: 'Volume as a table' });
    await expect(table.getByRole('row').nth(1)).toContainText('19 Oct 2026');
    await look(page, 'analytics-overview-table');
  });

  test('days with no data: a band, the totals over the days with data', async ({
    page,
  }) => {
    await open(page, '/analytics', 'Overview', through('2026-10-15'));
    await expect(
      page.getByText('No data for 16–19 Oct', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('In the 26 days with data').first(),
    ).toBeVisible();
    await look(page, 'analytics-overview-no-data');
  });

  test('a new organization: counts are 0, rates and times say why', async ({
    page,
  }) => {
    await open(page, '/analytics', 'Overview', {
      'GET /analytics/overview': overview(EMPTY.overview, EMPTY.overview),
      'GET /analytics/volume': ok(EMPTY.volume),
      'GET /analytics/deflection': ok(EMPTY.deflection),
      'GET /analytics/satisfaction': ok(EMPTY.satisfaction),
      'GET /analytics/response-times': ok(EMPTY.responseTimes),
    });
    await expect(page.getByText('No chats yet').first()).toBeVisible();
    await expect(page.getByText('No tickets in this period')).toBeVisible();
    await look(page, 'analytics-overview-new');
  });

  test('not computed yet: the daily job hasn’t run', async ({ page }) => {
    await open(page, '/analytics', 'Overview', through(null));
    await expect(
      page.getByText('Analytics haven’t been computed yet'),
    ).toBeVisible();
    await expect(page.getByText('Not computed yet').first()).toBeVisible();
    await look(page, 'analytics-overview-not-computed');
  });

  test('loading', async ({ page }) => {
    await open(page, '/analytics', 'Overview', {
      'GET /analytics/overview': hang,
    });
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading analytics' }),
    ).toBeAttached();
    await look(page, 'analytics-overview-loading');
  });

  test('error', async ({ page }) => {
    await open(page, '/analytics', 'Overview', {
      'GET /analytics/overview': failed(500),
    });
    await expect(
      page.getByRole('heading', { name: 'Couldn’t load analytics' }),
    ).toBeVisible();
    await look(page, 'analytics-overview-error');
  });

  test('the date range picker', async ({ page }) => {
    await open(page, '/analytics', 'Overview');
    await pickerButton(page).click();
    await expect(
      page.getByRole('option', { name: 'Last 30 days' }),
    ).toHaveAttribute('aria-selected', 'true');
    await look(page, 'analytics-picker', { viewportOnly: true });
  });

  test('the picker stops at the plan’s limit (Starter, 30 days)', async ({
    page,
  }) => {
    const starter = await tenant('analytics-starter');
    await setAnalyticsRange(starter.maya, 30);
    await open(
      page,
      '/analytics',
      'Overview',
      {},
      { tenant: 'analytics-starter' },
    );
    await pickerButton(page).click();
    await expect(
      page.getByRole('option', { name: 'Last 90 days' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await expect(
      page.getByText('Your plan shows up to 30 days at a time.'),
    ).toBeVisible();
    await look(page, 'analytics-picker-limit', { viewportOnly: true });
  });

  test('a longer range in the address is clamped, with a toast', async ({
    page,
  }) => {
    await setAnalyticsRange((await tenant('analytics-starter')).maya, 30);
    await open(
      page,
      '/analytics',
      'Overview',
      {},
      { query: 'from=2026-07-01&to=2026-10-19', tenant: 'analytics-starter' },
    );
    await expect(page.getByText('Showing the last 30 days')).toBeVisible();
    await expect(page).toHaveURL(/from=2026-09-20&to=2026-10-19/);
  });
});

test.describe('Agents and knowledge', () => {
  test('Agents', async ({ page }) => {
    await open(page, '/analytics/agents', 'Agents');
    await expect(
      page.getByText('6 agents with tickets or messages in the period.'),
    ).toBeVisible();
    await look(page, 'analytics-agents');
  });

  test('Agents, read by a Knowledge Manager', async ({ page }) => {
    const found = await tenant('analytics-km');
    await giveOnly(found.maya, found.priya, 'Knowledge Manager', [
      'document.read',
      'analytics.read',
      'ticket.read.all',
      'department.read',
    ]);
    await open(
      page,
      '/analytics/agents',
      'Agents',
      {},
      {
        as: () => found.priya,
      },
    );
    await expect(
      page.getByRole('combobox', { name: 'Department' }),
    ).toBeVisible();
    await look(page, 'analytics-agents-km');
  });

  test('Agents: one block unavailable (AI draft acceptance)', async ({
    page,
  }) => {
    await open(page, '/analytics/agents', 'Agents', {
      'GET /analytics/agents': ok({
        ...AGENTS,
        unavailable: [{ source: 'ingestion-service', reason: 'UNAVAILABLE' }],
      }),
    });
    await expect(
      page.getByText('AI draft acceptance couldn’t be read'),
    ).toBeVisible();
    await expect(page.getByText('Not available').first()).toBeVisible();
    await look(page, 'analytics-agents-unavailable');
  });

  test('Agents: no activity in the period', async ({ page }) => {
    await open(
      page,
      '/analytics/agents',
      'Agents',
      { 'GET /analytics/agents': ok({ ...AGENTS, items: [] }) },
      { query: 'from=2026-10-13&to=2026-10-19&department=facilities' },
    );
    await expect(
      page.getByText('No agent activity in this period'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Clear the department' }),
    ).toBeVisible();
    await look(page, 'analytics-agents-empty');
  });

  test('Knowledge', async ({ page }) => {
    await open(page, '/analytics/knowledge', 'Knowledge');
    await expect(
      page.getByText(
        '2 open. Each links to the document’s page; resolve them there.',
      ),
    ).toBeVisible();
    await look(page, 'analytics-knowledge');
  });

  test('Knowledge: the gaps and their flags unavailable', async ({ page }) => {
    await open(page, '/analytics/knowledge', 'Knowledge', {
      'GET /analytics/knowledge-gaps': ok({
        ...GAPS,
        flags: [],
        unavailable: [{ source: 'ingestion-service', reason: 'UNAVAILABLE' }],
      }),
    });
    await expect(
      page.getByText('The open flags couldn’t be read'),
    ).toBeVisible();
    await look(page, 'analytics-knowledge-unavailable');
  });

  test('Knowledge: a new organization', async ({ page }) => {
    await open(page, '/analytics/knowledge', 'Knowledge', {
      'GET /analytics/knowledge-gaps': ok(EMPTY.gaps),
      'GET /analytics/documents': ok(EMPTY.documents),
    });
    await expect(page.getByText('No open flags')).toBeVisible();
    await look(page, 'analytics-knowledge-new');
  });
});

test.describe('AI usage and feedback', () => {
  test('AI usage', async ({ page }) => {
    await open(page, '/analytics/ai-usage', 'AI usage');
    await expect(page.getByText('$4.59 of $10.00')).toBeVisible();
    await look(page, 'analytics-ai-usage');
  });

  test('AI usage: over this month’s allowance', async ({ page }) => {
    await open(page, '/analytics/ai-usage', 'AI usage', {
      'GET /analytics/ai-usage': ok({
        ...AI_USAGE,
        cycleSpentMicros: 10_420_000,
      }),
    });
    await expect(
      page.getByText('Over this month’s AI allowance'),
    ).toBeVisible();
    await expect(page.getByText('104% used')).toBeVisible();
    await look(page, 'analytics-ai-usage-over');
  });

  test('Feedback', async ({ page }) => {
    await open(page, '/analytics/feedback', 'Feedback');
    await expect(
      page.getByRole('link', { name: 'Ticket #1042' }),
    ).toBeVisible();
    await look(page, 'analytics-feedback');
  });

  test('Feedback: filtered and searched', async ({ page }) => {
    await open(page, '/analytics/feedback', 'Feedback', {
      'GET /feedback': (route: Route) => {
        const query = new URL(route.request().url()).searchParams;
        const term = query.get('searchTerm') ?? '';
        const items = FEEDBACK_PAGE.items.filter(
          (item) =>
            item.rating === -1 &&
            item.citationAccurate === false &&
            (item.feedbackText ?? '').toLowerCase().includes(term),
        );
        return route.fulfill(
          ok({
            items,
            meta: {
              ...FEEDBACK_PAGE.meta,
              totalItems: items.length,
              itemCount: items.length,
              totalPages: 1,
            },
          }),
        );
      },
    });
    await page.getByRole('combobox', { name: 'Rating' }).click();
    await page.getByRole('option', { name: 'Not helpful' }).click();
    await page.getByRole('combobox', { name: 'Citations' }).click();
    await page.getByRole('option', { name: 'Inaccurate' }).click();
    await page
      .getByRole('searchbox', { name: 'Search comments' })
      .fill('policy');
    await expect(
      page.getByText('It cited last year’s expense policy.').first(),
    ).toBeVisible();
    await look(page, 'analytics-feedback-filtered');
  });

  test('Feedback: none yet', async ({ page }) => {
    await open(page, '/analytics/feedback', 'Feedback', {
      'GET /feedback': ok(NOTHING),
    });
    await expect(
      page.getByRole('heading', { name: 'No feedback yet' }),
    ).toBeVisible();
    await look(page, 'analytics-feedback-none');
  });

  test('Feedback: no results for the filters', async ({ page }) => {
    await open(page, '/analytics/feedback', 'Feedback', {
      'GET /feedback': (route: Route) =>
        route.fulfill(
          ok(
            new URL(route.request().url()).searchParams.get('searchTerm')
              ? NOTHING
              : FEEDBACK_PAGE,
          ),
        ),
    });
    await page
      .getByRole('searchbox', { name: 'Search comments' })
      .fill('printer');
    await expect(
      page.getByRole('heading', { name: 'No feedback matches' }),
    ).toBeVisible();
    await look(page, 'analytics-feedback-no-results');
  });
});

test.describe('Export and access', () => {
  const EXPORT_ID = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
  const exporting = (status: 'PENDING' | 'READY' | 'FAILED'): Overrides => ({
    'POST /analytics/export': ok(
      {
        id: EXPORT_ID,
        status: 'PENDING',
        kind: 'TICKET',
        createdAt: '2026-10-19T17:00:00.000Z',
      },
      202,
    ),
    [`GET /analytics/export/${EXPORT_ID}`]: ok({
      id: EXPORT_ID,
      status,
      kind: 'TICKET',
      rowCount: status === 'READY' ? 415 : null,
      rollupComputedAt: null,
      downloadUrl:
        status === 'READY' ? 'https://storage.test/export.csv' : null,
      error: status === 'FAILED' ? 'boom' : null,
      createdAt: '2026-10-19T17:00:00.000Z',
      completedAt: status === 'PENDING' ? null : '2026-10-19T17:01:00.000Z',
    }),
  });

  test('Export: what, the range and a department', async ({ page }) => {
    await open(page, '/analytics', 'Overview');
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Export analytics' }),
    ).toBeVisible();
    await look(page, 'analytics-export', { viewportOnly: true });
  });

  test('Export: a range over 92 days', async ({ page }) => {
    await open(
      page,
      '/analytics',
      'Overview',
      {},
      {
        query: 'from=2026-04-23&to=2026-10-19',
      },
    );
    await page.getByRole('button', { name: 'Export' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export analytics' });
    await expect(
      dialog.getByText('An export can cover up to 92 days. This range is 180.'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Export' })).toBeDisabled();
    await look(page, 'analytics-export-too-long', { viewportOnly: true });
  });

  for (const [status, words] of [
    ['PENDING', 'Preparing your export…'],
    ['READY', 'Your export is ready'],
    ['FAILED', 'The export failed'],
  ] as const) {
    test(`Export: ${status.toLowerCase()}`, async ({ page }) => {
      await open(page, '/analytics', 'Overview', exporting(status));
      await page.getByRole('button', { name: 'Export' }).click();
      await page
        .getByRole('dialog', { name: 'Export analytics' })
        .getByRole('button', { name: 'Export' })
        .click();
      await expect(page.locator('#main').getByText(words)).toBeVisible();
      await look(page, `analytics-export-${status.toLowerCase()}`, {
        viewportOnly: true,
        mask: [page.locator('.animate-spin')],
      });
    });
  }

  test('a Support Agent: no Analytics entry, and the page isn’t available', async ({
    page,
  }) => {
    await open(page, '/analytics', null, {}, { as: (found) => found.jordan });
    await expect(
      page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Analytics' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'This page isn’t available' }),
    ).toBeVisible();
    await look(page, 'analytics-unavailable');
  });
});
