/**
 * @file Reading a service's database directly, from outside it.
 *
 * **The far end of a boundary is a row**, and reading it is what makes step 6 an
 * assertion rather than a spy. The existing suites spy on publishers precisely
 * because they cannot observe the other end; this harness can, so it should.
 *
 * Read-only by intent. Nothing here writes: the journey drives every write
 * through the API, because a row this file inserted proves nothing about
 * whether two services agree.
 */

import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as NotificationPrisma } from '../../apps/notification-service/src/generated/prisma/client';
import { REPO_ROOT } from './services';

/**
 * A service's own `DATABASE_URL`, from its own `.env`.
 *
 * **Read rather than re-declared.** A connection string repeated in a test
 * config is one that points at last month's database the first time somebody
 * changes a port, and the failure reads as "the row never appeared".
 */
function databaseUrl(service: string): string {
  const parsed = config({
    path: `${REPO_ROOT}/apps/${service}/.env`,
    processEnv: {},
  });

  const url = parsed.parsed?.DATABASE_URL;
  if (!url) {
    throw new Error(`No DATABASE_URL in apps/${service}/.env`);
  }

  return url;
}

/**
 * `notification-service`'s database.
 *
 * Constructed with the driver adapter the service itself uses — the generated
 * client has no default datasource, so a bare `new PrismaClient()` throws.
 */
export function notificationDb(): NotificationPrisma {
  return new NotificationPrisma({
    adapter: new PrismaPg({
      connectionString: databaseUrl('notification-service'),
    }),
  });
}
