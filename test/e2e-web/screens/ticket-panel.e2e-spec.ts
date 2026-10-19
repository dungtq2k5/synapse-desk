import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '../coverage';
import { api } from '../support';
import { look } from './look';
import { sessionAs, signInAs, tenant, type Person } from './tenant';

/**
 * The ticket's side panel: Details, AI and History, beside the thread at
 * 1440 and in a sheet from the header at 390. The AI's answers are played in
 * at the network (the AI needs a model); everything else is the tenant's.
 */

async function open(page: Page, person: Person, ticketId: string) {
  await signInAs(page, person);
  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
}

/**
 * Draws a tab of the panel at both widths: in the aside at 1440, then in the
 * sheet at 390. `ready` runs on each surface before it's drawn.
 */
async function panel(
  page: Page,
  name: string,
  tab: 'Details' | 'AI' | 'History',
  ready: (scope: Locator) => Promise<void>,
) {
  const aside = page.locator('aside');
  await aside.getByRole('tab', { name: tab, exact: true }).click();
  await ready(aside);
  await look(page, name, { widths: ['desktop'] });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ticket details' }).click();
  const sheet = page.getByRole('dialog', { name: /^Ticket #\d+$/ });
  await sheet.getByRole('tab', { name: tab, exact: true }).click();
  await ready(sheet);
  await look(page, name, { widths: ['phone'], viewportOnly: true });
}

/** Runs the metered sections, which wait to be asked; already run, they show. */
async function ask(scope: Locator) {
  for (const name of ['Get suggestions', 'Suggest routing']) {
    const button = scope.getByRole('button', { name });
    if (await button.isVisible()) await button.click();
  }
}

const envelope = (data: unknown, status = 200) => ({
  status,
  json: {
    success: true,
    statusCode: status,
    message: 'OK',
    warning: null,
    data,
  },
});
const failure = (status: number) => ({
  status,
  json: { success: false, statusCode: status, message: 'Request failed' },
});

const AT = '2026-10-10T09:24:00.000Z';
const SUMMARY = {
  id: randomUUID(),
  ticketId: '',
  summaryText:
    'Priya wants a **€450 standing desk**; the allowance is **€500 a year**.\n\n- Finance confirmed desks are in scope this year.\n- She hasn’t bought it yet.',
  suggestedAction:
    'Confirm the allowance and close the ticket after she claims.',
  confidenceScore: 0.86,
  modelName: 'demo',
  createdAt: AT,
  updatedAt: AT,
};
const STEPS = [
  {
    title: 'Confirm the allowance',
    body: 'Reply with the amount Finance will pay back in her **next expense payment**.',
    confidenceScore: 0.72,
  },
  {
    title: 'Point her to the claim form',
    body: 'Link the [Expenses claim form](https://example.com/claims) and the 30-day deadline.',
    confidenceScore: 0.64,
  },
];
const ARTICLES = [
  {
    documentId: randomUUID(),
    documentTitle: 'Home-office allowance policy.pdf',
    pageNumber: 2,
    score: 0.81,
  },
  {
    documentId: randomUUID(),
    documentTitle: 'Expenses FAQ',
    pageNumber: 4,
    score: 0.74,
  },
];
const SIMILAR = [
  ['Monitor allowance for part-time staff', 0.91],
  ['Claiming a desk chair over the limit', 0.84],
  ['Home-office allowance in euros', 0.79],
].map(([title, score], index) => ({
  ticketId: randomUUID(),
  ticketNumber: 900 + index,
  title,
  similarityScore: score,
}));

type Answers = {
  summary?: () => object | undefined;
  generate?: () => object | undefined;
  suggestions?: () => object | undefined;
  classify?: () => object | undefined;
  similar?: () => object | undefined;
};

/** Plays the AI's answers in; `undefined` leaves a call waiting. */
async function answer(page: Page, answers: Answers) {
  const reply =
    (make?: () => object | undefined) =>
    (route: { fulfill: (response: object) => Promise<void> }) => {
      const response = make?.();
      return response ? route.fulfill(response) : new Promise<void>(() => {});
    };
  await page.route('**/api/v1/tickets/*/ai/summary', (route) =>
    route.request().method() === 'POST'
      ? reply(answers.generate)(route)
      : reply(answers.summary)(route),
  );
  await page.route(
    '**/api/v1/tickets/*/ai/suggestions',
    reply(answers.suggestions),
  );
  await page.route('**/api/v1/tickets/*/ai/classify', reply(answers.classify));
  await page.route('**/api/v1/tickets/*/similar', reply(answers.similar));
}

test.describe('the AI tab', () => {
  test('everything loaded', async ({ page }) => {
    const { maya, facilitiesId, tickets } = await tenant('panel');
    await answer(page, {
      summary: () => envelope(SUMMARY),
      suggestions: () =>
        envelope({ nextSteps: STEPS, articles: ARTICLES, degraded: null }),
      classify: () =>
        envelope({
          suggestedDepartmentId: facilitiesId,
          suggestedPriority: 'HIGH',
          confidenceScore: 0.82,
        }),
      similar: () => envelope(SIMILAR),
    });
    await open(page, maya, tickets.desk);
    await panel(page, 'panel-ai', 'AI', async (scope) => {
      await ask(scope);
      await expect(scope.getByText('€450 standing desk')).toBeVisible();
      await expect(
        scope.getByRole('button', { name: 'Assign to Facilities' }),
      ).toBeVisible();
      await expect(
        scope.getByRole('link', { name: 'Expenses claim form' }),
      ).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(scope.getByText('91%')).toBeVisible();
    });
  });

  test('on open: suggestions and routing wait to be asked', async ({
    page,
  }) => {
    const { maya, tickets } = await tenant('panel');
    const metered: string[] = [];
    page.on('request', (request) => {
      if (/\/ai\/(suggestions|classify)$/.test(request.url())) {
        metered.push(request.url());
      }
    });
    await answer(page, {
      summary: () => envelope(SUMMARY),
      similar: () => envelope(SIMILAR),
    });
    await open(page, maya, tickets.desk);
    await panel(page, 'panel-ai-not-run', 'AI', async (scope) => {
      await expect(
        scope.getByRole('button', { name: 'Get suggestions' }),
      ).toBeVisible();
      await expect(
        scope.getByRole('button', { name: 'Suggest routing' }),
      ).toBeVisible();
      await expect(scope.getByText('€450 standing desk')).toBeVisible();
    });
    expect(metered).toEqual([]);
  });

  test('loading', async ({ page }) => {
    const { maya, tickets } = await tenant('panel');
    await answer(page, {});
    await open(page, maya, tickets.desk);
    await panel(page, 'panel-ai-loading', 'AI', async (scope) => {
      await ask(scope);
      await expect(scope.getByText('Finding suggestions…')).toBeVisible();
      await expect(scope.getByText('Classifying…')).toBeVisible();
    });
  });

  test('nothing yet', async ({ page }) => {
    const { maya, tickets } = await tenant('panel');
    await answer(page, {
      summary: () => failure(404),
      suggestions: () =>
        envelope({ nextSteps: [], articles: [], degraded: null }),
      classify: () =>
        envelope({
          suggestedDepartmentId: '',
          suggestedPriority: null,
          confidenceScore: 0,
        }),
      similar: () => envelope([]),
    });
    await open(page, maya, tickets.desk);
    await panel(page, 'panel-ai-empty', 'AI', async (scope) => {
      await ask(scope);
      await expect(
        scope.getByText(
          'No summary yet. Generate one to catch up on this ticket.',
        ),
      ).toBeVisible();
      await expect(
        scope.getByText('No suggestions for this ticket.'),
      ).toBeVisible();
      await expect(
        scope.getByText('No suggestion for this ticket.'),
      ).toBeVisible();
      await expect(
        scope.getByText('No similar resolved tickets.'),
      ).toBeVisible();
    });
  });

  test('search was limited', async ({ page }) => {
    const { maya, facilitiesId, tickets } = await tenant('panel');
    await answer(page, {
      summary: () => envelope(SUMMARY),
      suggestions: () =>
        envelope({
          nextSteps: [],
          articles: ARTICLES,
          degraded: 'LEXICAL_ONLY',
        }),
      classify: () =>
        envelope({
          suggestedDepartmentId: facilitiesId,
          suggestedPriority: 'HIGH',
          confidenceScore: 0.82,
        }),
      similar: () => envelope(SIMILAR),
    });
    await open(page, maya, tickets.desk);
    await panel(page, 'panel-ai-limited', 'AI', async (scope) => {
      await ask(scope);
      await expect(
        scope.getByText('Search was limited, so these may be less relevant.'),
      ).toBeVisible();
    });
  });

  test('errors, each with Try again', async ({ page }) => {
    const { maya, tickets } = await tenant('panel');
    await answer(page, {
      summary: () => failure(500),
      suggestions: () => failure(500),
      classify: () => failure(500),
      similar: () => failure(500),
    });
    await open(page, maya, tickets.desk);
    await panel(page, 'panel-ai-errors', 'AI', async (scope) => {
      await ask(scope);
      for (const title of [
        'Couldn’t load the summary',
        'Couldn’t load suggestions',
        'Couldn’t classify this ticket',
        'Couldn’t load similar tickets',
      ]) {
        await expect(scope.getByRole('alert').getByText(title)).toBeVisible();
      }
    });
  });

  test('402: the summary and routing; suggestions fall back', async ({
    page,
  }) => {
    const { maya, tickets } = await tenant('panel');
    await answer(page, {
      summary: () => failure(404),
      generate: () => failure(402),
      suggestions: () =>
        envelope({
          nextSteps: [],
          articles: ARTICLES,
          degraded: 'LEXICAL_ONLY',
        }),
      classify: () => failure(402),
      similar: () => envelope(SIMILAR),
    });
    await open(page, maya, tickets.desk);
    await panel(page, 'panel-ai-402', 'AI', async (scope) => {
      await ask(scope);
      await scope.getByRole('button', { name: 'Generate' }).click();
      await expect(
        scope.getByText('The summary can’t be generated.', { exact: false }),
      ).toBeVisible();
      await expect(
        scope.getByText('Routing can’t be suggested.', { exact: false }),
      ).toBeVisible();
    });
  });

  test('Assign to the suggested department', async ({ page }) => {
    const { maya, facilitiesId, tickets } = await tenant('panel');
    await answer(page, {
      summary: () => envelope(SUMMARY),
      suggestions: () =>
        envelope({ nextSteps: STEPS, articles: ARTICLES, degraded: null }),
      classify: () =>
        envelope({
          suggestedDepartmentId: facilitiesId,
          suggestedPriority: 'HIGH',
          confidenceScore: 0.82,
        }),
      similar: () => envelope(SIMILAR),
    });
    await open(page, maya, tickets.desk);
    await page
      .locator('aside')
      .getByRole('tab', { name: 'AI', exact: true })
      .click();
    await ask(page.locator('aside'));
    await page.getByRole('button', { name: 'Assign to Facilities' }).click();
    const dialog = page.getByRole('dialog', { name: /^Assign ticket #\d+$/ });
    await expect(dialog).toContainText(
      'Suggested by AI: Facilities, High (82%). Check it before you assign.',
    );
    await expect(
      dialog.getByLabel('Also set the priority to High'),
    ).toBeChecked();
    await expect(dialog.getByRole('combobox', { name: 'Reason' })).toHaveText(
      'Department change',
    );
    await look(page, 'panel-ai-assign');
  });

  test('without ticket.ai.use: the summary to read, similar tickets', async ({
    page,
  }) => {
    const { maya, jordan, tickets } = await tenant('panel-no-ai');
    const mayas = await sessionAs(maya);
    const { id: roleId } = await api<{ id: string }>(mayas, 'POST', '/roles', {
      name: 'Agent without AI',
      permissionCodes: [
        'ticket.read.all',
        'ticket.update',
        'ticket.resolve',
        'department.read',
        'user.read',
      ],
    });
    await api(mayas, 'PUT', `/users/${jordan.id}/roles`, { roleIds: [roleId] });
    await mayas.dispose();
    await answer(page, {
      summary: () => envelope(SUMMARY),
      similar: () => envelope(SIMILAR),
    });
    await open(page, jordan, tickets.desk);
    await panel(page, 'panel-ai-no-ai', 'AI', async (scope) => {
      await expect(scope.getByText('€450 standing desk')).toBeVisible();
      await expect(
        scope.getByRole('button', { name: 'Regenerate' }),
      ).toHaveCount(0);
      await expect(scope.getByText('Suggestions', { exact: true })).toHaveCount(
        0,
      );
      await expect(
        scope.getByText('Suggested routing', { exact: true }),
      ).toHaveCount(0);
      await expect(scope.getByText('Similar resolved tickets')).toBeVisible();
    });
  });
});

test('the History tab: status changes and assignments, newest first', async ({
  page,
}) => {
  const { maya, tickets } = await tenant('panel');
  await open(page, maya, tickets.desk);
  await panel(page, 'panel-history', 'History', async (scope) => {
    await expect(scope.getByText('New → Open', { exact: true })).toBeVisible();
    await expect(
      scope.getByText('Assigned to Maya Chen in Workplace: self-assigned'),
    ).toBeVisible();
    await expect(scope.getByText('Reason: Screens fixture')).toBeVisible();
  });
});

test('Details: the requester first', async ({ page }) => {
  const { maya, tickets } = await tenant('panel');
  await open(page, maya, tickets.desk);
  await panel(page, 'panel-details', 'Details', async (scope) => {
    await expect(
      scope.getByRole('tabpanel', { name: 'Details' }).getByText('Priya Shah'),
    ).toBeVisible();
  });
});
