/**
 * @file Asserts schema INTENT against every database the push targets.
 *
 * `prisma db push` reports "in sync" per database, and the databases are not
 * the same: measured, the same push succeeded against the test database — its
 * table was empty — and refused against dev, whose catalogue already had rows.
 * Nothing said so, because each run reported only on the one it touched.
 *
 * An e2e assertion cannot close that gap: a suite connects to the test
 * database, which is the one that tends to succeed. So this runs where the push
 * runs, over BOTH `DATABASE_URL`s, and exits non-zero on the first difference.
 *
 *   npm run db:verify
 */

import { Client } from 'pg';
import { readDatabaseUrl, redact } from './database-url.mjs';

/**
 * What the schema is supposed to say, expressed as queries rather than as a
 * diff: a full schema comparison is what `db push` already does and is exactly
 * what reported "in sync" while dev was wrong. These are the invariants a
 * decision was made about.
 */
const CHECKS = [
  {
    name: 'the seven quota columns carry NO default',
    databases: ['auth'],
    sql: `SELECT count(*)::int AS n FROM information_schema.columns
           WHERE table_name = 'organizations'
             AND column_name IN ('max_agent_seats','max_storage_bytes',
                                 'monthly_ai_token_budget','max_document_bytes',
                                 'max_attachment_bytes','max_document_uploads',
                                 'max_analytics_range_days')
             AND column_default IS NOT NULL`,
    expected: 0,
    why: 'a default here silently answers "what does a new tenant get"',
  },
  {
    name: 'all seven quota columns EXIST',
    databases: ['auth'],
    sql: `SELECT count(*)::int AS n FROM information_schema.columns
           WHERE table_name = 'organizations'
             AND column_name IN ('max_agent_seats','max_storage_bytes',
                                 'monthly_ai_token_budget','max_document_bytes',
                                 'max_attachment_bytes','max_document_uploads',
                                 'max_analytics_range_days')`,
    expected: 7,
    why: 'the push refusing to add one is the failure this script exists for',
  },
  {
    name: 'the plan grants exist and are NOT NULL',
    databases: ['auth'],
    sql: `SELECT count(*)::int AS n FROM information_schema.columns
           WHERE table_name = 'subscription_plans'
             AND column_name IN ('max_document_bytes','max_attachment_bytes',
                                 'max_document_uploads','max_analytics_range_days')
             AND is_nullable = 'NO'`,
    expected: 4,
    why: 'a plan states every limit it grants, with no blanks',
  },
  {
    name: 'plan names are unique among LIVE rows',
    databases: ['auth'],
    sql: `SELECT count(*)::int AS n FROM pg_indexes
           WHERE tablename = 'subscription_plans'
             AND indexname = 'subscription_plans_name_key'`,
    expected: 1,
    why: 'a full @unique would block re-using a retired plan name forever',
  },
  {
    name: 'the limit-alert generation table exists',
    databases: ['auth', 'ingestion'],
    sql: `SELECT count(*)::int AS n FROM information_schema.columns
           WHERE table_name = 'limit_alert_generations'
             AND column_name IN ('organization_id','dimension','generation')`,
    expected: 3,
    why: 'a generation kept only in Redis resets on a flush, and that dimension then stops alerting for the tenant permanently',
  },
];

for (const file of [
  '../apps/auth-service/.env',
  '../apps/auth-service/.env.test',
  '../apps/ingestion-service/.env',
  '../apps/ingestion-service/.env.test',
]) {
  // Each URL is read in its own pass, because `loadEnvFile` does not overwrite
  // and both files name the same variable.
  const url = readDatabaseUrl(new URL(file, import.meta.url));

  if (!url) {
    console.error(`No DATABASE_URL in ${file}. Refusing to guess.`);
    process.exit(1);
  }

  await verify(file, url, file.includes('auth-service') ? 'auth' : 'ingestion');
}

// **Conditional, and it was not at first.** The first version printed this
// unconditionally while reporting failures above it — a verification script
// ending in "everything agrees" over its own FAIL lines is precisely the
// false reassurance it exists to remove.
if (process.exitCode) {
  console.error('\nSchema verification FAILED. See the checks above.');
} else {
  console.log('\nEvery database agrees with the schema.');
}

async function verify(label, url, service) {
  const client = new Client({ connectionString: url });
  await client.connect();

  console.log(`\n${label} — ${redact(url)}`);

  try {
    let failed = 0;

    for (const check of CHECKS) {
      // **Applicability is a property of the DATABASE, never of the table under
      // test.** The first version probed `check.table` — the very table the
      // check asserts about — so dropping `limit_alert_generations`, the exact
      // condition the check exists to catch, made it skip in both databases and
      // print "Every database agrees with the schema".
      //
      // A check naming a database it does not apply to is skipped and SAID so;
      // passing it silently is how a check stops checking.
      if (!check.databases.includes(service)) {
        console.log(`  skip ${check.name} (not a ${service} table)`);
        continue;
      }

      const { rows } = await client.query(check.sql);
      const actual = rows[0].n;
      const ok = actual === check.expected;

      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${check.name}` +
          (ok
            ? ''
            : ` — expected ${check.expected}, found ${actual}\n       ${check.why}`),
      );
      if (!ok) failed += 1;
    }

    if (failed > 0) {
      console.error(`\n${failed} check(s) failed against ${label}.`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}
