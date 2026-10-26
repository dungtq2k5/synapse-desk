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
import { join, relative } from 'node:path';
import { hasChanges, migrationFolder } from './lib/new-migration.cjs';

let folder;
try {
  folder = migrationFolder(process.argv[2]);
} catch (error) {
  console.error(error.message);
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

if (!hasChanges(sql)) {
  console.error('schema.prisma matches the migrations: nothing to migrate.');
  process.exit(1);
}

mkdirSync(folder);
writeFileSync(join(folder, 'migration.sql'), sql);
console.log(`Wrote ${relative(process.cwd(), folder)}/migration.sql`);
