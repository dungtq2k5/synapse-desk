/**
 * @file One client per service, built from that service's OWN `.env`.
 *
 * **Never `process.env.DATABASE_URL`.** Three services name the same variable,
 * and in one process it means whichever file was read last — a seeder that
 * writes every service's rows into one database and reports success.
 * `verify-schema.mjs` hit this first and wrote the answer down: read each URL in
 * its own pass and hand it to that connection explicitly.
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { REPO_ROOT } from './paths';
import { isLocalDatabase, readDatabaseUrl, redact } from '../database-url.mjs';
import { PrismaClient as AuthPrismaClient } from '../../apps/auth-service/src/generated/prisma/client';
import { PrismaClient as TicketPrismaClient } from '../../apps/ticket-service/src/generated/prisma/client';
import { PrismaClient as IngestionPrismaClient } from '../../apps/ingestion-service/src/generated/prisma/client';
import type { PrismaService as AuthPrismaService } from '../../apps/auth-service/src/modules/prisma/prisma.service';
import type { PrismaService as TicketPrismaService } from '../../apps/ticket-service/src/modules/prisma/prisma.service';
import type { PrismaService as IngestionPrismaService } from '../../apps/ingestion-service/src/modules/prisma/prisma.service';

/** Where each service's dev connection string lives. */
const ENV_FILES: Record<'auth' | 'ticket' | 'ingestion', string> = {
  auth: 'apps/auth-service/.env',
  ticket: 'apps/ticket-service/.env',
  ingestion: 'apps/ingestion-service/.env',
};

/**
 * The safety helpers, from the module every destructive script already uses.
 *
 * Typed by `database-url.d.mts` rather than rewritten: `db:verify` and
 * `db:reset` are plain Node and have no reason to become TypeScript, and
 * re-deriving `isLocalDatabase` here would be a second copy of the one check
 * standing between this script and a production database.
 */
/** Reads a service's dev `DATABASE_URL`, refusing anything not on this machine. */
export function urlFor(service: keyof typeof ENV_FILES): string {
  const file = pathToFileURL(join(REPO_ROOT, ENV_FILES[service]));
  // The types returned by 'searchParams.entries()' are incompatible between these types.
  // Property 'next' is missing in type 'URLSearchParamsIterator<[string, string]>' but required in type 'IterableIterator<[string, string]>'.
  const url = readDatabaseUrl(file);

  if (!url) {
    throw new Error(`No DATABASE_URL in ${ENV_FILES[service]}`);
  }

  // The same bar `reset-databases.mjs` sets, by the same function rather than a
  // second copy of the regex.
  if (!isLocalDatabase(url)) {
    throw new Error(
      `${ENV_FILES[service]} does not point at this machine (${redact(url)}). The demo seeder writes only to local databases.`,
    );
  }

  // A test database is reset by its suite, and a row seeded into one is a
  // cross-suite failure that reads as flakiness — a family this repository
  // already has three known-gap rows about.
  if (/_test(\?|$)/.test(url)) {
    throw new Error(
      `${ENV_FILES[service]} names a TEST database. The suites own those.`,
    );
  }

  return url;
}

function clientFor<T>(
  service: keyof typeof ENV_FILES,
  Client: new (options: { adapter: PrismaPg }) => T,
): T {
  return new Client({
    adapter: new PrismaPg({ connectionString: urlFor(service) }),
  });
}

/**
 * The factories are typed `prisma: PrismaService`, and a `PrismaClient` is not
 * one — `PrismaService` also implements `OnModuleInit`/`OnModuleDestroy` and
 * takes a `ConfigService` that reads `process.env`.
 *
 * **One narrow cast per service, at the seeder's edge.** Every factory touches
 * the QUERY surface only — none calls a lifecycle hook — so the cast is sound
 * for exactly the use the factories make of it, and the alternative is standing
 * up three Nest application contexts to obtain three database connections.
 * Written here, once, rather than at each call site.
 */
export function openClients() {
  const auth = clientFor('auth', AuthPrismaClient);
  const ticket = clientFor('ticket', TicketPrismaClient);
  const ingestion = clientFor('ingestion', IngestionPrismaClient);

  return {
    auth: auth as unknown as AuthPrismaService,
    ticket: ticket as unknown as TicketPrismaService,
    ingestion: ingestion as unknown as IngestionPrismaService,
    async close(): Promise<void> {
      await Promise.all([
        auth.$disconnect(),
        ticket.$disconnect(),
        ingestion.$disconnect(),
      ]);
    },
  };
}

export type SeedClients = ReturnType<typeof openClients>;
