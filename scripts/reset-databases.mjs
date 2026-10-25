#!/usr/bin/env node
/**
 * Drops and recreates every local service database, dev AND test, then gives
 * each its schema the way production does (`npm run db:apply`).
 *
 *   npm run db:reset
 *   npm run db:reset -- --test-only     # leave the dev databases alone
 *   npm run db:reset -- --dev-only      # leave the test databases alone
 *   npm run db:reset -- --test-only ingestion-service   # only the named services
 *
 * Per service and env file (`.env`, `.env.test`): `DROP DATABASE … WITH
 * (FORCE)`, `CREATE DATABASE`, the same for its `SHADOW_DATABASE_URL`, then
 * `db:apply` (or `db:apply:test`). Creating a database is this script's job
 * only: `db:apply` refuses a missing one.
 *
 * **Build first** (`npm run build`): `db:apply` runs each service's built
 * `dist/src/schema-apply.js`, and a missing build is refused before anything is
 * dropped.
 *
 * DESTRUCTIVE, AND ONLY FOR THIS MACHINE. Every row in every target goes. It
 * refuses any connection string that does not point at this machine, checks
 * every target before dropping any, and has no `--force`. The two flags are
 * mutually exclusive; a pipeline that runs beside an e2e suite passes
 * `--dev-only` so the suite's test databases survive.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { isLocalDatabase, readDatabaseUrl, redact } from './database-url.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const testOnly = process.argv.includes('--test-only');
const devOnly = process.argv.includes('--dev-only');

if (testOnly && devOnly) {
  console.error(
    '--test-only and --dev-only are mutually exclusive. Pass neither to reset both.',
  );
  process.exit(1);
}

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

// Discovered rather than listed: a service added later is included without
// anyone remembering this file.
const withSchema = readdirSync(join(REPO_ROOT, 'services'))
  .filter((name) =>
    existsSync(join(REPO_ROOT, 'services', name, 'prisma/schema.prisma')),
  )
  .sort();

if (withSchema.length === 0) {
  fail('No service has a prisma/schema.prisma. Nothing to reset.');
}

// A mistyped flag would otherwise reset dev AND test.
const badFlags = process.argv
  .slice(2)
  .filter(
    (arg) =>
      arg.startsWith('--') && !['--test-only', '--dev-only'].includes(arg),
  );

if (badFlags.length > 0) {
  fail(`Unknown flag ${badFlags.join(', ')}. Use --test-only or --dev-only.`);
}

// Services named on the command line, or every one.
const named = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const unknown = named.filter((name) => !withSchema.includes(name));

if (unknown.length > 0) {
  fail(
    `No schema service named ${unknown.join(', ')}. Choose from: ${withSchema.join(', ')}.`,
  );
}

const services =
  named.length > 0
    ? withSchema.filter((name) => named.includes(name))
    : withSchema;

const envFiles = testOnly
  ? ['.env.test']
  : devOnly // NOSONAR
    ? ['.env']
    : ['.env', '.env.test'];

// Every URL is resolved and checked BEFORE anything is dropped, so a refusal
// never leaves some databases reset and some not.
const targets = [];

for (const service of services) {
  if (
    !existsSync(
      join(REPO_ROOT, 'services', service, 'dist/src/schema-apply.js'),
    )
  ) {
    fail(
      `services/${service} is not built (no dist/src/schema-apply.js). Run \`npm run build\` first.`,
    );
  }

  for (const envFile of envFiles) {
    const fileUrl = new URL(
      `../services/${service}/${envFile}`,
      import.meta.url,
    );
    const urls = ['DATABASE_URL', 'SHADOW_DATABASE_URL'].map((key) => {
      const url = readDatabaseUrl(fileUrl, key);

      if (!url) {
        fail(`No ${key} in services/${service}/${envFile}. Refusing to guess.`);
      }
      if (!isLocalDatabase(url)) {
        fail(
          `services/${service}/${envFile} ${key} points at ${redact(url)}, which is not this machine.\n` +
            'Refusing. This script has no --force: a remote database is not something it should reach.',
        );
      }
      return url;
    });

    targets.push({ service, envFile, urls });
  }
}

/** Drops and creates the database `url` names, from the server's `postgres`. */
async function recreate(url) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  parsed.pathname = '/postgres';
  parsed.search = '';

  const client = new pg.Client({ connectionString: parsed.toString() });
  await client.connect();

  try {
    // Identifiers cannot be bind parameters; `name` comes from a tracked or
    // local env file, and the quoting below escapes it.
    const quoted = `"${name.replaceAll('"', '""')}"`;
    await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await client.end();
  }
}

console.log(
  `Resetting ${targets.length} database(s) across ${services.length} service(s):\n`,
);

const recreated = new Set();

for (const { service, envFile, urls } of targets) {
  console.log(`  ${service} ${envFile} — ${redact(urls[0])}`);

  try {
    // The shadow database is shared by `.env` and `.env.test`: once is enough.
    for (const url of urls.filter((url) => !recreated.has(url))) {
      await recreate(url);
      recreated.add(url);
    }

    execFileSync(
      'npm', // NOSONAR
      ['run', envFile === '.env' ? 'db:apply' : 'db:apply:test'],
      {
        cwd: join(REPO_ROOT, 'services', service),
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
      },
    );
  } catch (error) {
    console.error(`\n  FAILED: ${service} ${envFile}`);
    fail(error.stderr || error.message);
  }
}

console.log(
  '\nEvery database is migrated, with its schema objects, and EMPTY of rows.',
);
