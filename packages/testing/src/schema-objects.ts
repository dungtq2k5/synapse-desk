/**
 * @file Dropping named INDEXES, so a test can watch the seeder put them back.
 *
 * **Nothing could do this before, and that is part of why the gate survived.**
 * `SEED_ON_BOOTSTRAP=false` used to skip the whole DDL block — a defect no test
 * could catch, because no test could construct the "pushed but not seeded"
 * database it produces. A check for it needs to drop what the seeder creates,
 * run the boot hook, and look again.
 *
 * **Indexes only, and the name says so deliberately.** The seeder's DDL block
 * also holds `CHECK` constraints and extensions; `DROP INDEX IF EXISTS` on a
 * constraint name no-ops silently and `missingIndexes` then reports it missing
 * forever, so a caller who passed one would get a red test naming the wrong
 * thing. Teaching these functions about constraints (`ALTER TABLE … DROP
 * CONSTRAINT`, `pg_constraint`) is the better answer and is worth doing when a
 * test needs it — not before.
 *
 * Test-only, and deliberately narrow: it drops named objects, never a schema.
 */

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
