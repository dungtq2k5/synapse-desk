/**
 * @file Who the journey acts as.
 *
 * **A seeded admin, not a fresh registration.** The first draft registered a
 * user and drove everything as them; every write returned
 * `403 Requires one of: ticket.create`. That is not a defect — registration is
 * *"usable immediately but LIMITED"*, by design — but it means a registrant is
 * the wrong actor for a journey about what the product does.
 *
 * **And the manifest is what makes it a KNOWN dataset.** The seeder writes
 * `.demo-seed/manifest.json` with the tenants it created, so the journey reads
 * the slug rather than guessing it — which is the difference between "a list
 * came back" and "the list has the rows the seeder wrote".
 */

import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as AuthPrisma } from '../../apps/auth-service/src/generated/prisma/client';
import { REPO_ROOT } from './services';

/** The one password every demo user shares — `seed-demo/steps/auth.step.ts`. */
export const DEMO_PASSWORD = 'DemoPassw0rd!';

type Manifest = {
  seed: number;
  tenants: { organizationId: string; name: string; slug: string }[];
};

export function manifest(): Manifest {
  const path = `${REPO_ROOT}/.demo-seed/manifest.json`;

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch {
    throw new Error(
      `No demo manifest at ${path}. The stack starts and seeds it — see global-setup.ts.`,
    );
  }
}

/**
 * The first tenant's admin.
 *
 * `user-0@<slug>.demo.test` is the seeder's own convention, and the first user
 * of each tenant is the one it grants `ORG_ADMIN` to — *"every later step
 * authors as one of these, never as an id it invented"*.
 */
export type Actor = { id: string; email: string };

/**
 * The first tenant's admin and one colleague.
 *
 * **Read from auth's database, because there is no route that lists them.**
 * `/users` serves `me` only; the cross-tenant list is `/platform/users` behind
 * `SuperAdminGuard`. This is ARRANGEMENT, not assertion — every write the
 * journey makes still goes through the API, and a row this file selected proves
 * nothing on its own.
 *
 * **A colleague is required, not optional.** The consumer's audience filter
 * says *"Never notify the actor"*, so assigning a ticket to yourself publishes
 * correctly, consumes correctly and writes no delivery row. A journey that did
 * that would fail for thirty seconds against a system that was working —
 * measured, and the reason this returns two people rather than one.
 */
export async function seededActors(): Promise<{
  admin: Actor;
  colleague: Actor;
}> {
  const [tenant] = manifest().tenants;
  if (!tenant) throw new Error('The demo manifest lists no tenants');

  const parsed = config({
    path: `${REPO_ROOT}/apps/auth-service/.env`,
    processEnv: {},
  });
  const connectionString = parsed.parsed?.DATABASE_URL;
  if (!connectionString)
    throw new Error('No DATABASE_URL in auth-service/.env');

  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const users = await prisma.user.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, email: true },
      // `user-0@…` is the one the seeder grants ORG_ADMIN to, and its address
      // sorts first — the seeder's own convention, relied on rather than
      // re-derived.
      orderBy: { email: 'asc' },
    });

    const [admin, colleague] = users;

    if (!admin || !colleague) {
      throw new Error(
        `Tenant ${tenant.slug} has ${users.length} user(s); the journey needs at ` +
          'least two, because nobody is notified of their own action.',
      );
    }

    return { admin, colleague };
  } finally {
    await prisma.$disconnect();
  }
}
