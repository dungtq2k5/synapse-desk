/**
 * @file One client per service, built from that service's OWN `.env`.
 *
 * **Never `process.env.DATABASE_URL`.** Three services name the same variable,
 * and in one process it means whichever file was read last — a seeder that
 * writes every service's rows into one database and reports success. Each URL
 * is read in its own pass and handed to that connection explicitly.
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { REPO_ROOT } from './paths';
import {
  isSeedableDatabase,
  readDatabaseUrl,
  redact,
} from '../database-url.mjs';
import { PrismaClient as AuthPrismaClient } from '../../services/auth-service/src/generated/prisma/client';
import { PrismaClient as TicketPrismaClient } from '../../services/ticket-service/src/generated/prisma/client';
import { PrismaClient as IngestionPrismaClient } from '../../services/ingestion-service/src/generated/prisma/client';
import type { PrismaService as AuthPrismaService } from '../../services/auth-service/src/modules/prisma/prisma.service';
import type { PrismaService as TicketPrismaService } from '../../services/ticket-service/src/modules/prisma/prisma.service';
import type { PrismaService as IngestionPrismaService } from '../../services/ingestion-service/src/modules/prisma/prisma.service';

/** Where each service's dev connection string lives. */
const ENV_FILES: Record<'auth' | 'ticket' | 'ingestion', string> = {
  auth: 'services/auth-service/.env',
  ticket: 'services/ticket-service/.env',
  ingestion: 'services/ingestion-service/.env',
};

/** The variable that names it instead, read first: the demo's `tools` sets them. */
const ENV_VARIABLES: Record<keyof typeof ENV_FILES, string> = {
  auth: 'AUTH_DATABASE_URL',
  ticket: 'TICKET_DATABASE_URL',
  ingestion: 'INGESTION_DATABASE_URL',
};

/**
 * The safety helpers, from the module every destructive script already uses.
 *
 * Typed by `database-url.d.mts` rather than rewritten: `db:reset` is plain
 * Node and has no reason to become TypeScript, and re-deriving `isLocalDatabase` here would be a second copy of the one check
 * standing between this script and a production database.
 */
/**
 * A service's database: its `*_DATABASE_URL` variable when set, else the
 * `DATABASE_URL` in its dev `.env`. Refuses anything not on this machine, or
 * not a host `SEED_DATABASE_HOSTS` names.
 */
export function urlFor(service: keyof typeof ENV_FILES): string {
  const variable = ENV_VARIABLES[service];
  const source = process.env[variable] ? variable : ENV_FILES[service];
  // The types returned by 'searchParams.entries()' are incompatible between these types.
  // Property 'next' is missing in type 'URLSearchParamsIterator<[string, string]>' but required in type 'IterableIterator<[string, string]>'.
  const url =
    process.env[variable] ||
    readDatabaseUrl(pathToFileURL(join(REPO_ROOT, ENV_FILES[service])));

  if (!url) {
    throw new Error(
      `No ${variable}, and no DATABASE_URL in ${ENV_FILES[service]}`,
    );
  }

  // The bar `reset-databases.mjs` sets, by the same module rather than a second
  // copy of the regex, plus the demo's named hosts.
  if (!isSeedableDatabase(url)) {
    throw new Error(
      `${source} does not point at this machine (${redact(url)}). The demo seeder writes only to local databases, or to hosts SEED_DATABASE_HOSTS names.`,
    );
  }

  // A test database is reset by its suite, and a row seeded into one is a
  // cross-suite failure that reads as flakiness — a family this repository
  // already has three known-gap rows about.
  if (/_test(\?|$)/.test(url)) {
    throw new Error(`${source} names a TEST database. The suites own those.`);
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
