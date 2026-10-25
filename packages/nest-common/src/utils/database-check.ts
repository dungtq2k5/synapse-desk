import { Client } from 'pg';

/**
 * Whether the database `url` names is ready for `prisma migrate deploy`, as a
 * sentence when it is not.
 *
 * The first of the schema step's three commands (each service's `db:apply`,
 * and the `migrate` image's `CMD`). Two states are refused:
 *
 *   - **the database does not exist** (Postgres `3D000`). `migrate deploy`
 *     would create it and migrate it, so a mistyped `DATABASE_URL` would
 *     provision an empty database and the service would start on it. Creating
 *     a database is `npm run db:reset`'s job, on this machine only.
 *   - **tables, but no `_prisma_migrations`**: built by `prisma db push`.
 *     `migrate deploy` stops on it with P3005, which names neither cause nor
 *     fix.
 *
 * An empty database, or one with migration history, is ready. Tables are
 * counted in the URL's `?schema=` (default `public`), the schema Prisma
 * migrates.
 *
 * @example
 *   await databaseProblem('postgresql://u:p@localhost:5432/missing')
 *   // 'Database "missing" does not exist on localhost:5432. …'
 */
export async function databaseProblem(
  url: string,
): Promise<string | undefined> {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const schema = parsed.searchParams.get('schema') ?? 'public';
  const client = new Client({ connectionString: url });

  try {
    await client.connect();
  } catch (error) {
    if ((error as { code?: string }).code === '3D000') {
      return (
        `Database "${database}" does not exist on ${parsed.host}. Nothing was ` +
        'created: on this machine, `npm run db:reset` creates it; anywhere ' +
        'else, the database is provisioned before the schema step runs.'
      );
    }
    throw error;
  }

  try {
    const { rows } = await client.query<{ tables: number; history: boolean }>(
      `SELECT count(*)::int AS tables,
              bool_or(table_name = '_prisma_migrations') AS history
         FROM information_schema.tables
        WHERE table_schema = $1`,
      [schema],
    );
    const { tables, history } = rows[0];

    if (tables > 0 && !history) {
      return (
        `Database "${database}" has tables but no _prisma_migrations: ` +
        '`prisma db push` built it, and `migrate deploy` cannot apply ' +
        'migrations over it. On this machine, run `npm run db:reset` once ' +
        '(it empties every local database); a deployed database is ' +
        'baselined instead (k8s/README.md).'
      );
    }

    return undefined;
  } finally {
    await client.end();
  }
}

/**
 * The entry each service's `src/database-check.ts` runs: checks
 * `DATABASE_URL`, prints the problem and exits 1, or exits 0 silently.
 */
export function runDatabaseCheck(): void {
  const url = process.env['DATABASE_URL'];

  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  databaseProblem(url).then(
    (problem) => {
      if (problem) {
        console.error(problem);
        process.exit(1);
      }
    },
    (error: unknown) => {
      console.error(
        `Could not check the database: ${(error as Error).message}`,
      );
      process.exit(1);
    },
  );
}
