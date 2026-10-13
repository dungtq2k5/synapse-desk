import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { CLIENT_EVENTS, REALTIME_EVENTS } from '@synapsedesk/contracts';
import { api } from '../support';
import { look, tabsThrough } from './look';
import { sessionAs, signInAs, tenant, type Person } from './tenant';

/**
 * The ticket page, in every state, light and dark, at both widths. The thread
 * renders on the server, so it is the tenant's own (tenant.ts: every kind of
 * entry and every stored AI answer status). Live states come from the people
 * themselves, in a second browser or through the API, or from frames played
 * into this page's socket where the server can't be asked for them (an
 * answer mid-stream, one that failed, one that was stopped).
 */

async function open(page: Page, person: Person, ticketId: string) {
  await signInAs(page, person);
  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
}

test.describe('the thread', () => {
  test('as the assignee: every entry, the composer', async ({ page }) => {
    const { maya, tickets } = await tenant('thread');
    await open(page, maya, tickets.desk);
    await expect(
      page.getByText('Finance confirmed desks are in scope this year.'),
    ).toBeVisible();
    await expect(page.getByText('This message was removed.')).toBeVisible();
    await look(page, 'ticket-agent');
  });

  test('as the assignee: the composer’s focus order', async ({ page }) => {
    const { maya, tickets } = await tenant('thread');
    await open(page, maya, tickets.desk);
    await expect(
      page.getByText('Finance confirmed desks are in scope this year.'),
    ).toBeVisible();
    await expect(page.getByText('This message was removed.')).toBeVisible();

    await page.getByRole('radio', { name: 'Reply' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAccessibleName(
      /^Reply to Priya$/,
    );
    await page.keyboard.type('On it.');
    await tabsThrough(page, [/^Send reply$/]);
  });

  test('as the assignee, writing an internal note', async ({ page }) => {
    const { maya, tickets } = await tenant('thread');
    await open(page, maya, tickets.desk);
    await page.getByRole('radio', { name: 'Internal note' }).click();
    await expect(
      page
        .getByRole('form', { name: 'Internal note' })
        .getByText('INTERNAL NOTE · Only agents can see this'),
    ).toBeVisible();
    await look(page, 'ticket-agent-note');
  });

  test('as the person who raised it: no notes, one composer, ask a person', async ({
    page,
  }) => {
    const { priya, tickets } = await tenant('thread');
    await open(page, priya, tickets.desk);
    await expect(
      page.getByText('Finance confirmed desks are in scope this year.'),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Ask a person' }),
    ).toBeVisible();
    await look(page, 'ticket-requester');
  });

  test('as another agent: only the assignee can reply', async ({ page }) => {
    const { jordan, tickets } = await tenant('thread');
    await open(page, jordan, tickets.desk);
    await expect(
      page.getByText('Only the assignee can reply or add notes.'),
    ).toBeVisible();
    await look(page, 'ticket-other-agent');
  });

  test('a closed ticket says so instead of a composer', async ({ page }) => {
    const { maya, tickets } = await tenant('thread');
    await open(page, maya, tickets.printer);
    await expect(page.getByText('This ticket is closed.')).toBeVisible();
    await look(page, 'ticket-closed');
  });

  test("not found: we can't find that ticket", async ({ page }) => {
    const { maya } = await tenant('thread');
    await signInAs(page, maya);
    await page.goto(`/tickets/${randomUUID()}`);
    await expect(
      page.getByRole('heading', { name: 'We can’t find that ticket' }),
    ).toBeVisible();
    await look(page, 'ticket-not-found');
  });

  test('a reply that was not sent, with Retry', async ({ page }) => {
    const { maya, tickets } = await tenant('thread');
    await open(page, maya, tickets.desk);
    await page.route('**/api/v1/tickets/*/messages', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 500,
            json: {
              success: false,
              statusCode: 500,
              error: 'Internal server error!',
            },
          })
        : route.fallback(),
    );
    await page.getByRole('textbox', { name: 'Reply to Priya' }).fill('On it.');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await look(page, 'ticket-send-failed');
  });
});

test.describe('an answer from the AI, live', () => {
  /**
   * This page's socket, with frames played into it: the gateway's own
   * `{ success, message, data }` frames on the `/ws` namespace. A cancel the
   * page sends is answered here, never reaching the server.
   */
  async function tap(page: Page) {
    let socket: WebSocketRoute | undefined;
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
      const server = ws.connectToServer();
      socket = ws;
      ws.onMessage((frame) => {
        const cancel = new RegExp(
          `^42/ws,(\\d+)\\["${CLIENT_EVENTS.aiStreamCancel}"`,
        ).exec(String(frame));
        if (cancel) {
          ws.send(
            `43/ws,${cancel[1]}${JSON.stringify([
              {
                success: true,
                message: 'Cancelled',
                data: { cancelled: true },
              },
            ])}`,
          );
        } else {
          server.send(frame);
        }
      });
      server.onMessage((frame) => ws.send(frame));
    });
    return async (event: string, data: unknown) => {
      // The page connects after it hydrates; play once it has.
      await expect.poll(() => socket !== undefined).toBe(true);
      await page.waitForTimeout(500);
      socket!.send(
        `42/ws,${JSON.stringify([event, { success: true, message: 'OK', data }])}`,
      );
    };
  }

  test('streaming, then stopped by the person who asked', async ({ page }) => {
    const { priya, tickets } = await tenant('thread');
    const play = await tap(page);
    await open(page, priya, tickets.desk);
    await play(REALTIME_EVENTS.aiStreamChunk, {
      streamId: 'stream-1',
      ticketId: tickets.desk,
      token: 'Yes. The home-office allowance covers',
    });
    await expect(page.getByText('Writing an answer…')).toBeVisible();
    await look(page, 'ticket-ai-streaming');

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(
      page.getByText('Answer stopped.', { exact: false }),
    ).toBeVisible();
    await look(page, 'ticket-ai-stopped');
  });

  test('at the AI limit: the assistant isn’t available', async ({ page }) => {
    const { priya, tickets } = await tenant('thread');
    const play = await tap(page);
    await open(page, priya, tickets.desk);
    await play(REALTIME_EVENTS.aiStreamDone, {
      streamId: 'stream-3',
      ticketId: tickets.desk,
      messageId: null,
      status: 'AT_CAP',
    });
    await expect(
      page.getByText('The assistant isn’t available right now.'),
    ).toBeVisible();
    await look(page, 'ticket-ai-at-cap');
  });

  test('broken off before it finished', async ({ page }) => {
    const { priya, tickets } = await tenant('thread');
    const play = await tap(page);
    await open(page, priya, tickets.desk);
    await play(REALTIME_EVENTS.aiStreamChunk, {
      streamId: 'stream-2',
      ticketId: tickets.desk,
      token: 'Yes. The home-office',
    });
    await play(REALTIME_EVENTS.aiStreamError, {
      streamId: 'stream-2',
      ticketId: tickets.desk,
    });
    await expect(
      page.getByText('The answer stopped before it finished.', {
        exact: false,
      }),
    ).toBeVisible();
    await look(page, 'ticket-ai-failed');
  });
});

test.describe('the thread, live', () => {
  test('who else is viewing, and who is typing', async ({ page, browser }) => {
    const { maya, jordan, priya, tickets } = await tenant('presence');
    await open(page, maya, tickets.desk);

    const others = await Promise.all(
      [jordan, priya].map(async (person) => {
        const context = await browser.newContext();
        const other = await context.newPage();
        await open(other, person, tickets.desk);
        return { context, page: other };
      }),
    );
    await expect(page.getByText('Jordan Lee is also viewing')).toBeVisible();
    // Typing repeats while the hint lasts; the first one is enough to draw.
    await others[1].page
      .getByRole('textbox')
      .pressSequentially('Thanks', { delay: 50 });
    await expect(page.getByText('Priya Shah is typing…')).toBeVisible();
    // Priya keeps typing while the captures run: typing ends 3 s after the
    // last keystroke, and four captures take longer than that on a runner.
    const keepTyping = setInterval(() => {
      void others[1].page.keyboard.type('.').catch(() => undefined);
    }, 1_000);
    try {
      await look(page, 'ticket-presence');
    } finally {
      clearInterval(keepTyping);
    }
    for (const other of others) await other.context.close();
  });

  test('a new message while reading further up: the pill', async ({ page }) => {
    const { maya, priya, tickets } = await tenant('pill');
    await open(page, maya, tickets.desk);
    await page.setViewportSize({ width: 1440, height: 500 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const priyas = await sessionAs(priya);
    await api(priyas, 'POST', `/tickets/${tickets.desk}/messages`, {
      content: 'Here’s the size I need, too.',
      isInternalNote: false,
      invokeAi: false,
    });
    await priyas.dispose();
    await expect(
      page.getByRole('button', { name: /1 new message/ }),
    ).toBeVisible();
    await look(page, 'ticket-new-message-pill');
  });

  // A status change, not a priority one: ticket-service publishes no event
  // when only the priority changes, so that doesn't land in place.
  test('a status change lands in place', async ({ page }) => {
    const { maya, tickets } = await tenant('changes');
    await open(page, maya, tickets.desk);
    const mayas = await sessionAs(maya);
    await api(mayas, 'POST', `/tickets/${tickets.desk}/status`, {
      status: 'PENDING_AGENT',
      reason: 'Waiting on Finance',
    });
    await mayas.dispose();
    await expect(
      page.getByRole('main').getByText('Pending agent').first(),
    ).toBeVisible();
    await look(page, 'ticket-changed-in-place');
  });
});

test.describe('ask a person', () => {
  test('asking: busy until the support team answers', async ({ page }) => {
    const { priya, tickets } = await tenant('ask-busy');
    await open(page, priya, tickets.desk);
    await page.route('**/api/v1/tickets/*/escalate', () => undefined);
    await page.getByRole('button', { name: 'Ask a person' }).click();
    await expect(page.getByRole('button', { name: 'Asking…' })).toBeDisabled();
    await look(page, 'ticket-ask-busy');
  });

  test('asking failed: a toast with Try again', async ({ page }) => {
    const { priya, tickets } = await tenant('ask-failed');
    await open(page, priya, tickets.desk);
    await page.route('**/api/v1/tickets/*/escalate', (route) =>
      route.fulfill({
        status: 500,
        json: {
          success: false,
          statusCode: 500,
          error: 'Internal server error!',
        },
      }),
    );
    await page.getByRole('button', { name: 'Ask a person' }).click();
    await expect(
      page.getByText('Couldn’t reach the support team'),
    ).toBeVisible();
    await look(page, 'ticket-ask-failed', { viewportOnly: true });
  });

  test('asked: the escalation notice takes focus', async ({ page }) => {
    const { priya, tickets } = await tenant('ask');
    await open(page, priya, tickets.desk);
    await page.getByRole('button', { name: 'Ask a person' }).click();
    await expect(page.locator(':focus')).toContainText(
      'Escalated to the support team.',
    );
    await expect(
      page.getByRole('button', { name: 'Ask a person' }),
    ).toHaveCount(0);
    await look(page, 'ticket-asked');
  });
});
