import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { generateSync } from 'otplib';
import Redis from 'ioredis';

export { DEMO_PASSWORD, manifest, seededActors } from '../system/seeded-actor';

/**
 * Clears the gateway's rate-limit counters. Sign-in allows 5 attempts per
 * address per 15 minutes, and every row signs in through the same address;
 * the run already starts from a flushed Redis, so this changes nothing a row
 * asserts.
 */
export async function clearThrottles(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  try {
    const keys = await redis.keys('throttle:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

/**
 * Waits until the page's layout stops moving: the document's scroll size and
 * `main`'s box hold for 500 ms, or 5 s pass. After a resize or a text-size
 * change, measuring at once catches the layout mid-way.
 *
 * @example
 * await page.setViewportSize({ width: 1280, height: 800 });
 * await settled(page);
 * expect(await sideways(page)).toEqual([]);
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const signature = () => {
      const root = document.documentElement;
      const main = document.querySelector('main')?.getBoundingClientRect();
      return [
        root.scrollWidth,
        root.scrollHeight,
        main?.x,
        main?.y,
        main?.width,
        main?.height,
      ].join();
    };
    const start = performance.now();
    let last = signature();
    let since = start;
    while (performance.now() - start < 5000) {
      await new Promise((frame) => requestAnimationFrame(frame));
      const now = signature();
      if (now !== last) {
        last = now;
        since = performance.now();
      } else if (performance.now() - since >= 500) {
        return;
      }
    }
  });
}

/** The current code an authenticator app would show for this secret. */
export function totp(secret: string): string {
  return generateSync({ secret: secret.replaceAll(' ', '') });
}

/** Signs in through the sign-in page, as a person would. */
export async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * The gateway's REST API, for what a row needs to exist before the browser
 * looks: the same calls a client makes, through the same origin.
 */
export async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`/api/v1${path}`, { method, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(
    true,
  );
  return ((await response.json()) as { data: T }).data;
}
