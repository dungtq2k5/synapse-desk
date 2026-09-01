/**
 * @file Reap the fleet, then the stores.
 *
 * Order matters: the services are killed first so nothing is still writing
 * schedules into Redis while it is being flushed. Reversed, a service's
 * shutdown could re-register a repeat entry after the flush and leave exactly
 * the mess known-gap #7 describes.
 */

import { stopStack } from './stack';
import { resetStores } from './stores';

export default async function globalTeardown(): Promise<void> {
  await stopStack();
  await resetStores();
}
