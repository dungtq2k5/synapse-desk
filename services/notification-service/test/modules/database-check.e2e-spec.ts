import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';

/**
 * `npm run db:apply` refuses a database it must not migrate, before
 * `prisma migrate deploy` runs (`databaseProblem` in `@synapsedesk/nest-common`,
 * the first of the schema step's three commands). One service carries these
 * rows; the check is shared.
 *
 * Runs the BUILT script, as CI and the `migrate` image do: build first.
 */
describe('The schema step refuses a database it must not migrate (e2e)', () => {
  const SERVICE_ROOT = join(__dirname, '../..');
  const testUrl = new URL(process.env['DATABASE_URL'] ?? '');

  /** The test database's URL with another database name. */
  const urlFor = (database: string): string => {
    const url = new URL(testUrl);
    url.pathname = `/${database}`;
    return url.toString();
  };

  /** `npm run db:apply` against `url`; resolves with its exit code and stderr. */
  const dbApply = async (
    url: string,
  ): Promise<{ code: number; stderr: string }> => {
    try {
      const { stderr } = await promisify(execFile)(
        'npm',
        ['run', '--silent', 'db:apply'],
        { cwd: SERVICE_ROOT, env: { ...process.env, DATABASE_URL: url } },
      );
      return { code: 0, stderr };
    } catch (error) {
      const failed = error as { code: number; stderr: string };
      return { code: failed.code, stderr: failed.stderr };
    }
  };

  /** A client on the test database, for `pg_database` and scratch databases. */
  const withServer = async <T>(work: (client: Client) => Promise<T>) => {
    const client = new Client({ connectionString: testUrl.toString() });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  };

  const exists = (database: string) =>
    withServer(async (client) => {
      const { rowCount } = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [database],
      );
      return rowCount === 1;
    });

  it('**1. a missing database: refused with a sentence, and nothing created**', async () => {
    const database = `synapsedesk_notification_missing_${process.pid}`;
    await expect(exists(database)).resolves.toBe(false);

    const result = await dbApply(urlFor(database));

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      `Database "${database}" does not exist on ${testUrl.host}. Nothing was created`,
    );
    // `migrate deploy` would have created it.
    await expect(exists(database)).resolves.toBe(false);
  }, 60_000);

  it('2. tables without migration history: refused, naming `npm run db:reset`', async () => {
    const database = `synapsedesk_notification_pushed_${process.pid}`;
    await withServer((client) => client.query(`CREATE DATABASE "${database}"`));

    try {
      const scratch = new Client({ connectionString: urlFor(database) });
      await scratch.connect();
      await scratch.query('CREATE TABLE notifications (id text PRIMARY KEY)');
      await scratch.end();

      const result = await dbApply(urlFor(database));

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        `Database "${database}" has tables but no _prisma_migrations`,
      );
      expect(result.stderr).toContain('run `npm run db:reset` once');
    } finally {
      await withServer((client) =>
        client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
      );
    }
  }, 60_000);
});
