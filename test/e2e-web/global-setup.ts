import { join } from 'node:path';
import systemSetup from '../system/global-setup';
import systemTeardown from '../system/global-teardown';
import { REPO_ROOT, type ServiceSpec } from '../system/services';
import { startStack } from '../system/stack';
import { startIngress, WEB_PORT } from './ingress';

/** The built web app, started by the system harness like any service. */
const WEB: ServiceSpec = {
  pkg: '@synapsedesk/web',
  dir: 'apps/web',
  port: WEB_PORT,
  probe: { kind: 'http', path: '/login' },
  command: [
    join(REPO_ROOT, 'node_modules/.bin/next'),
    ['start', '--port', String(WEB_PORT)],
  ],
};

/**
 * `test/system`'s setup (reset the stores, build everything, the web app
 * included, start the services, seed the demo data), then the web app and
 * the ingress in front of it. The returned function is the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await systemSetup();

  // The renderer's one variable: the gateway, as the cluster's ConfigMap sets it.
  process.env.GATEWAY_URL = 'http://localhost:3000';
  try {
    await startStack({ services: [WEB] });
  } catch (error) {
    await systemTeardown();
    throw error;
  }
  const ingress = await startIngress();

  return async () => {
    ingress.closeAllConnections();
    await new Promise((resolve) => ingress.close(resolve));
    await systemTeardown();
  };
}
