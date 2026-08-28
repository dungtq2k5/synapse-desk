#!/usr/bin/env node
/**
 * Drops and recreates every service database, dev AND test, from the schema.
 *
 *   npm run db:reset
 *   npm run db:reset -- --test-only     # leave the dev databases alone
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm run db:push` is plain `prisma db push`: no `--accept-data-loss` and no
 * `--force-reset`, so it REFUSES a change that would drop data. That refusal is
 * the failure `db:verify` was written for — measured, the same push succeeded
 * against the empty test database and was rejected by dev, and each run reported
 * only on the database it touched.
 *
 * Being able to reset is the remedy for that; it was never the detector, and
 * until this script there was no command for it. Now there is: `db:verify` tells
 * you the schemas disagree, and this puts them back.
 *
 * WHAT IT DOES NOT DO — READ THIS BEFORE RUNNING `db:verify` AFTER IT
 * ------------------------------------------------------------------
 * A reset drops the PARTIAL UNIQUE INDEXES and the seed rows, because Prisma
 * cannot express either: `DatabaseSeeder` creates them from
 * `OnApplicationBootstrap`. So immediately after a reset, `db:verify`'s "plan
 * names are unique among LIVE rows" check FAILS — it looks for
 * `subscription_plans_name_key`, which does not exist again until a service
 * boots. That is the documented order, not a defect:
 *
 *   npm run db:reset  ->  start the services (or run the e2e suites)  ->  npm run db:verify
 *
 * The e2e suites boot the app themselves, so they reseed the test databases as
 * a side effect of running.
 *
 * DESTRUCTIVE, AND ONLY FOR LOCAL DEVELOPMENT. Every row in every service
 * database goes. It refuses any connection string that does not point at this
 * machine, and `--force` is deliberately NOT offered: a remote database is not
 * a thing this script should be able to reach at all.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalDatabase, readDatabaseUrl, redact } from './database-url.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const testOnly = process.argv.includes('--test-only');

// Discovered rather than listed, for the reason `reset-jetstream.mjs` reads the
// live stream list: a service added later is included without anyone
// remembering this file, and a service removed cannot leave a stale entry.
const services = readdirSync(join(REPO_ROOT, 'apps'))
  .filter((name) =>
    existsSync(join(REPO_ROOT, 'apps', name, 'prisma/schema.prisma')),
  )
  .sort();

if (services.length === 0) {
  console.error('No service has a prisma/schema.prisma. Nothing to reset.');
  process.exit(1);
}

// Every URL is resolved and checked BEFORE anything is dropped. A guard that
// fires halfway leaves the tree in the one state this script exists to avoid:
// some databases reset, some not, and no record of which.
const targets = [];

for (const service of services) {
  const envFiles = testOnly ? ['.env.test'] : ['.env', '.env.test'];

  for (const envFile of envFiles) {
    const fileUrl = new URL(`../apps/${service}/${envFile}`, import.meta.url);
    const url = readDatabaseUrl(fileUrl);

    if (!url) {
      console.error(
        `No DATABASE_URL in apps/${service}/${envFile}. Refusing to guess.`,
      );
      process.exit(1);
    }

    if (!isLocalDatabase(url)) {
      console.error(
        `apps/${service}/${envFile} points at ${redact(url)}, which is not this machine.\n` +
          'Refusing. This script has no --force: a remote database is not something it should reach.',
      );
      process.exit(1);
    }

    targets.push({ service, envFile, url });
  }
}

console.log(
  `Resetting ${targets.length} database(s) across ${services.length} service(s):\n`,
);

for (const { service, envFile, url } of targets) {
  console.log(`  ${service} ${envFile} — ${redact(url)}`);

  // No `--skip-generate`: this Prisma CLI reads its datasource from
  // `prisma.config.ts` and does not accept that flag, so the client is
  // regenerated once per database. Slower, and the only option offered.
  const push = ['prisma', 'db', 'push', '--force-reset'];
  const args =
    envFile === '.env' ? push : ['dotenv', '-e', '.env.test', '--', ...push];

  try {
    execFileSync('npx', args, {
      cwd: join(REPO_ROOT, 'apps', service),
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
  } catch (error) {
    console.error(`\n  FAILED: ${service} ${envFile}`);
    console.error(error.stderr || error.message);
    process.exit(1);
  }
}

console.log(
  '\nEvery database is back to the schema, and EMPTY.\n' +
    'Partial indexes and seed rows are recreated when a service boots — start the\n' +
    'services (or run the e2e suites) before `npm run db:verify`.',
);
