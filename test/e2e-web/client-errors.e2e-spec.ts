import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './coverage';
import { clearThrottles, DEMO_PASSWORD, seededActors, signIn } from './support';

test.beforeEach(clearThrottles);

/**
 * A browser error, followed to the gateway: the test page throws outside
 * React, the web reports it, and the gateway's log has one line for it, with
 * the path but not its query.
 */

/** The `client_error` lines carrying `message` in the gateway's log, parsed. */
function linesFor(message: string): Record<string, unknown>[] {
  const log = join(process.env.SYSTEM_LOG_DIR ?? '', 'api-gateway.log');
  let text: string;
  try {
    text = readFileSync(log, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.includes('client_error') && line.includes(message))
    .map(
      (line) =>
        JSON.parse(
          line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1),
        ) as Record<string, unknown>,
    );
}

const MESSAGE = 'Thrown by the test page';

test('a browser error signed out reaches the gateway’s log, without the query', async ({
  page,
}) => {
  const before = linesFor(MESSAGE).length;

  await page.goto('/test-pages/throw?secret=hunter2#x');
  await page.getByRole('button', { name: 'Throw' }).click();

  await expect.poll(() => linesFor(MESSAGE).length).toBe(before + 1);
  const line = linesFor(MESSAGE).at(-1)!;
  expect(line).toMatchObject({
    event: 'client_error',
    kind: 'error',
    path: '/test-pages/throw',
  });
  expect(line.buildId).toEqual(expect.any(String));
  expect(line).not.toHaveProperty('userId');
  expect(JSON.stringify(line)).not.toContain('hunter2');
});

test('signed in, the line names the person and organization', async ({
  browser,
}) => {
  const { requester } = await seededActors();
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, requester.email, DEMO_PASSWORD);
  await expect(page).toHaveURL(/\/(tickets|ask)$/);
  const before = linesFor(MESSAGE).length;

  await page.goto('/test-pages/throw');
  await page.getByRole('button', { name: 'Throw' }).click();

  await expect.poll(() => linesFor(MESSAGE).length).toBe(before + 1);
  expect(linesFor(MESSAGE).at(-1)).toMatchObject({
    userId: requester.id,
    organizationId: expect.any(String),
  });

  await context.close();
});
