/**
 * @file Start what every row shares: this run's Redis and NATS.
 *
 * The gateway itself is NOT started here. A row may need its own environment
 * (a different `CORS`, a peer pointed somewhere else), so `startGateway` is
 * called per suite; what is shared is the infrastructure behind it.
 */

import { startInfra } from './infra';
import { createRunState } from './run-state';

export default function globalSetup(): void {
  const infra = startInfra();

  createRunState({
    containers: infra.containers,
    redisUrl: infra.redisUrl,
    natsUrl: infra.natsUrl,
  });
}
