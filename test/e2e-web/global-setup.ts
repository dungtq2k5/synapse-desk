import { cpSync } from 'node:fs';
import { join } from 'node:path';
import systemSetup from '../system/global-setup';
import systemTeardown from '../system/global-teardown';
import { REPO_ROOT, type ServiceSpec } from '../system/services';
import { startStack } from '../system/stack';
import { startBrowserServer, stopBrowserServer } from './browser-server';
import { useAuthEmulator } from './firebase';
import { startIngress, WEB_PORT } from './ingress';

/** Where `next build` puts the server the image runs (`output: 'standalone'`). */
const STANDALONE = 'apps/web/.next/standalone/apps/web';

/**
 * The built web app, as the image runs it: the standalone server, started by
 * the system harness like any service.
 */
const WEB: ServiceSpec = {
  pkg: '@synapsedesk/web',
  dir: STANDALONE,
  port: WEB_PORT,
  probe: { kind: 'http', path: '/login' },
  command: ['node', ['server.js']],
};

/**
 * The two directories `standalone` leaves out by design, copied beside its
 * server as `docker/web.Dockerfile` does.
 */
function completeStandalone(): void {
  const web = join(REPO_ROOT, 'apps/web');
  const server = join(REPO_ROOT, STANDALONE);
  cpSync(join(web, '.next/static'), join(server, '.next/static'), {
    recursive: true,
  });
  cpSync(join(web, 'public'), join(server, 'public'), { recursive: true });
}

/**
 * `test/system`'s setup (reset the stores, build everything, the web app
 * included, start the services, seed the demo data), then the web app, the
 * ingress in front of it, and the browser the screen rows render in
 * (browser-server.ts). The returned function is the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // Before the services start: auth-service reads its half as it boots.
  useAuthEmulator();
  // A one-minute edit window (15 in development): a journey watches Edit go
  // away without waiting a quarter of an hour, and a screen row's own fresh
  // message is still well inside it. The services inherit this environment.
  process.env.MESSAGE_EDIT_WINDOW_MINUTES = '1';
  // rag-service's model-free mode: fixed embeddings, and answers in fixed
  // text that cite their sources, with no key and no network. A run means
  // the same on every machine; the real model is the Python job's to test.
  process.env.RAG_OFFLINE_MODEL = 'true';
  // ingestion-service's half: uploads embed with the same fixed vectors, so
  // an uploaded document reaches INDEXED offline and Ask finds it.
  process.env.INGESTION_OFFLINE_MODEL = 'true';
  await systemSetup();

  completeStandalone();
  // The renderer's one variable, then where the standalone server listens:
  // the services above are already running, so only the web inherits these.
  process.env.GATEWAY_URL = 'http://localhost:3000';
  process.env.PORT = String(WEB_PORT);
  process.env.HOSTNAME = '127.0.0.1';
  try {
    await startStack({ services: [WEB] });
  } catch (error) {
    await systemTeardown();
    throw error;
  }
  const ingress = await startIngress();
  await startBrowserServer();

  return async () => {
    stopBrowserServer();
    ingress.closeAllConnections();
    await new Promise((resolve) => ingress.close(resolve));
    await systemTeardown();
  };
}
