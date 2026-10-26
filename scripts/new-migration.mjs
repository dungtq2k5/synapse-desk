#!/usr/bin/env node
/**
 * Writes the migration that takes the service's migrations to its
 * `schema.prisma`, as `prisma/migrations/<timestamp>_<name>/migration.sql`.
 * Run from a service as `npm run db:migrate -- <name>`.
 *
 *   npm run db:migrate -w @synapsedesk/notification-service -- webhook_disabled_code
 *
 * Prisma replays the migrations into the shadow database (SHADOW_DATABASE_URL)
 * and diffs the result with the schema file. The dev database is never read:
 * `prisma migrate dev` compares it with the migrations too, and the schema
 * objects `schema-apply` adds read to it as drift, so it asks for a reset.
 *
 * Refuses a missing or malformed name, and a schema with nothing to migrate.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const name = process.argv[2];

if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error(
    'Name the migration in snake_case: npm run db:migrate -- add_widget_color',
  );
  process.exit(1);
}

const sql = execFileSync(
  'npx', // NOSONAR
  [
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    'prisma/migrations',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);

if (!/^\s*(CREATE|ALTER|DROP|COMMENT)\b/im.test(sql)) {
  console.error('schema.prisma matches the migrations: nothing to migrate.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const migrations = resolve('prisma/migrations');
const entry = `${stamp}_${name}`;
const folder = resolve(migrations, entry);

// The name's pattern already keeps it a single folder; this says so where
// the path is used.
if (!folder.startsWith(migrations + sep)) {
  console.error(`${folder} is outside ${migrations}.`);
  process.exit(1);
}

mkdirSync(folder);
writeFileSync(resolve(folder, 'migration.sql'), sql);
console.log(`Wrote prisma/migrations/${entry}/migration.sql`);
