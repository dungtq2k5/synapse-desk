/**
 * @file The objects a service's seeder creates by name: reading the names from
 * its SQL, checking they exist, and dropping indexes so a test can watch the
 * seeder put them back.
 *
 * **Nothing could do this before, and that is part of why the gate survived.**
 * `SEED_ON_BOOTSTRAP=false` used to skip the whole DDL block — a defect no test
 * could catch, because no test could construct the "pushed but not seeded"
 * database it produces. A check for it needs to drop what the seeder creates,
 * run the boot hook, and look again.
 *
 * **Dropping is indexes only**: `DROP INDEX IF EXISTS` on a constraint name
 * no-ops silently, so `dropIndexes` takes index names and `missingIndexes`
 * checks only them. `missingObjects` checks both catalogues.
 *
 * Test-only, and deliberately narrow: it drops named objects, never a schema.
 */

import { stripComments } from './strip-comments';

/** The subset of `PrismaClient` this needs — no import of a generated client,
 * which is per-service and cannot be named from here. */
export type RawExecutor = {
  $executeRawUnsafe(query: string): Promise<number>;
  $queryRawUnsafe<T>(query: string): Promise<T>;
};

/**
 * Drops the named indexes, so the next `applySchemaObjects()` has work to do.
 *
 * `DROP INDEX IF EXISTS` rather than a schema reset: the tables must SURVIVE,
 * because the thing under test is a database that has been pushed and not
 * seeded — dropping the schema would instead exercise `assertSchemaExists`,
 * which is a different assertion in the same file.
 */
export async function dropIndexes(
  prisma: RawExecutor,
  indexNames: readonly string[],
): Promise<void> {
  for (const name of indexNames) {
    // Interpolated, and safe by construction: every caller passes a literal
    // from its own seeder. `$executeRawUnsafe` is required because an index
    // name cannot be a bind parameter.
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`);
  }
}

/** Whether every named index exists — the assertion side of the same coin. */
export async function missingIndexes(
  prisma: RawExecutor,
  indexNames: readonly string[],
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`,
  );
  const present = new Set(rows.map((row) => row.indexname));

  return indexNames.filter((name) => !present.has(name));
}

/**
 * Every object a seeder creates by name — `CREATE [UNIQUE] INDEX IF NOT EXISTS`
 * and `ADD CONSTRAINT` — read from its source.
 *
 * Comments are stripped first: a prose comment quoting `CREATE INDEX IF NOT
 * EXISTS on …` would otherwise yield the "name" `on`. Names must be literals in
 * the SQL; an interpolated name is invisible here.
 *
 * @example
 *   seederObjectNames(readFileSync('src/modules/prisma/database.seeder.ts', 'utf8'))
 *   // ['notifications_feed_idx', …]
 */
export function seederObjectNames(seederSource: string): string[] {
  const source = stripComments(seederSource);

  return [
    ...[
      ...source.matchAll(
        /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "?([a-z][a-z0-9_]*)"?/gi,
      ),
    ].map((match) => match[1]),
    ...[...source.matchAll(/ADD CONSTRAINT "([a-z0-9_]+)"/gi)].map(
      (match) => match[1],
    ),
  ];
}

/**
 * The named objects absent from the current schema, looking in both catalogues:
 * `pg_indexes` for indexes, `pg_constraint` for constraints.
 */
export async function missingObjects(
  prisma: RawExecutor,
  names: readonly string[],
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()
     UNION
     SELECT conname FROM pg_constraint
      WHERE connamespace = current_schema()::regnamespace`,
  );
  const present = new Set(rows.map((row) => row.name));

  return names.filter((name) => !present.has(name));
}
