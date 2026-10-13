import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { REPO_ROOT } from '../system/services';

/**
 * The browser the screen rows render in: Playwright's own server, inside the
 * official Playwright image at exactly the lockfile's `@playwright/test`
 * version. A screenshot is a function of the fonts and the renderer, so every
 * baseline, on every machine and in CI, is drawn by this one image.
 *
 * The server runs from the repository's own `node_modules`, mounted read-only:
 * nothing is downloaded into the container. The rows connect to it with
 * `exposeNetwork: '<loopback>'`, so the browser reaches the ingress on this
 * machine's localhost through the client, and the container needs no host
 * networking.
 */
export const BROWSER_PORT = 3940;
export const BROWSER_WS = `ws://127.0.0.1:${BROWSER_PORT}/`;
const CONTAINER = 'synapsedesk-playwright-browser';

/** `mcr.microsoft.com/playwright:v<lockfile version>-noble`. */
export function browserImage(): string {
  const { version } = JSON.parse(
    readFileSync(
      join(REPO_ROOT, 'node_modules/@playwright/test/package.json'),
      'utf8',
    ),
  ) as { version: string };
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}

export async function startBrowserServer(): Promise<void> {
  stopBrowserServer();
  execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--init',
      '--name',
      CONTAINER,
      '--user',
      'pwuser',
      '--publish',
      `127.0.0.1:${BROWSER_PORT}:${BROWSER_PORT}`,
      '--volume',
      `${join(REPO_ROOT, 'node_modules')}:/pw/node_modules:ro`,
      browserImage(),
      'node',
      '/pw/node_modules/@playwright/test/cli.js',
      'run-server',
      '--port',
      String(BROWSER_PORT),
      '--host',
      '0.0.0.0',
    ],
    { stdio: 'pipe' },
  );
  await waitForPort(BROWSER_PORT, 60_000);
}

export function stopBrowserServer(): void {
  try {
    execFileSync('docker', ['rm', '--force', CONTAINER], { stdio: 'pipe' });
  } catch {
    // Not running: nothing to stop.
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The Playwright browser server never listened on ${port}`);
}
