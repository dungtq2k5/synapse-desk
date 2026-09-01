/**
 * @file Is the known dataset actually there?
 *
 * **A system test that starts from a known dataset can assert exact numbers**,
 * which is the difference between "a list came back" and "the list has the rows
 * the seeder wrote". That only holds while the dataset is present, and an empty
 * database produces a failure three steps later about a count — pointing at the
 * journey rather than at the missing precondition.
 */

import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as AuthPrisma } from '../../apps/auth-service/src/generated/prisma/client';
import { REPO_ROOT } from './services';

/**
 * What to do when the dataset is missing.
 *
 * The wipe is the only step a person has to run: `globalSetup` seeds after the
 * stack is up, because both seeders depend on rows `DatabaseSeeder` writes at
 * boot and neither can run before one.
 */
const RECIPE = [
  'node scripts/reset-databases.mjs --dev-only   # DESTRUCTIVE: wipes the four dev databases',
  'npm run test:system                           # seeds on top of the wipe, after the stack is up',
].join('\n  ');

/** Tenant count, or 0 — the one question both callers below ask. */
async function tenantCount(): Promise<number> {
  const parsed = config({
    path: `${REPO_ROOT}/apps/auth-service/.env`,
    processEnv: {},
  });
  const connectionString = parsed.parsed?.DATABASE_URL;

  if (!connectionString) {
    throw new Error('No DATABASE_URL in apps/auth-service/.env');
  }

  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    // **Tenants, not "any row".** The seeder's whole product is a tenant with
    // an admin, departments and tickets; a database holding only the plan
    // catalogue a service writes at boot would pass a `count() > 0` check and
    // fail every assertion that matters.
    return await prisma.organization.count({ where: { deletedAt: null } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Whether the demo dataset is present — the seed's own idempotence check. */
export async function isSeeded(): Promise<boolean> {
  return (await tenantCount()) > 0;
}

/** The same question, as a failure that says what to run. */
export async function assertSeeded(): Promise<void> {
  if (await isSeeded()) return;

  throw new Error(
    'The dev databases hold no tenants, so the journey has nothing to assert against.\n' +
      `Run:\n  ${RECIPE}`,
  );
}
