/**
 * @file `npm run seed:demo` — a demo dataset across three databases.
 *
 * **`tsx` does not typecheck.** It compiles and runs, so a wrong enum member is
 * `undefined` at runtime rather than an error — measured, not theorized: an
 * earlier revision wrote `DocumentStatus.COMPLETED`, which does not exist, and
 * Prisma silently applied the column default. Every seeded document came out
 * `PENDING`, and the run reported success.
 *
 * These files are therefore in the ROOT tsconfig's program, so `npm run
 * typecheck` reads them like every other TypeScript here. There is deliberately
 * no second command: one named "typecheck the scripts" would assert that the
 * first one does not.
 *
 * **Dry run unless `--apply`**, matching `provision-stripe.mjs` and
 * `seed-plans.mjs`. Three scripts with one safety posture is a convention.
 *
 * ```
 * npm run seed:demo                                # print the plan, write nothing
 * npm run seed:demo -- --apply
 * npm run seed:demo -- --apply --profile=large
 * npm run seed:demo -- --apply --only=ticket
 * npm run seed:demo -- --apply --seed=42
 * npm run seed:demo -- --apply --force             # add to a populated database
 * ```
 *
 * **What it does NOT seed, and why it is not a bug:** no Qdrant vectors (fake
 * ones rank nonsense, so knowledge search returns an honest nothing), no
 * Firebase objects (a download 404s), no notification feed (§1c — those rows
 * are produced by consuming commands, and hand-writing them means minting the
 * `event_id`s that decide whether somebody has already been told), and no
 * Stripe customer or subscription (the grandfathered state the code handles
 * everywhere — verified: `listInvoices` returns empty before touching Stripe).
 */

import { faker } from '@faker-js/faker';
import { openClients } from './clients';
import { readManifest, writeManifest, type Manifest } from './manifest';
import { PROFILES } from './profiles';
import { parseArgs } from './args';
import { SEED_EDGES, STEPS } from './registry';

/** The seed the last run used, or `undefined` when there is no manifest. */
function safeManifestSeed(): number | undefined {
  try {
    return readManifest().seed;
  } catch {
    return undefined;
  }
}

function say(line = ''): void {
  console.log(line);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const profile = PROFILES[args.profile];

  // **Deterministic by default.** A demo you can screenshot twice, row counts a
  // smoke test can assert, and a bug report that says "tenant 3's ticket 17"
  // meaning the same rows on another machine.
  //
  // The caveat worth knowing: the factories' module-level counters are
  // per-PROCESS, so ids are stable across identical runs and NOT across a run
  // that seeds a different set. `--only=ticket` after a `--profile=large`
  // reproduces neither.
  faker.seed(args.seed);

  say(
    `profile ${args.profile}  seed ${args.seed}  ${args.apply ? 'APPLY' : 'dry run'}`,
  );
  say(`order   ${STEPS.map((step) => step.service).join(' → ')}`);
  for (const edge of SEED_EDGES) {
    say(`edge    ${edge.from} → ${edge.to}  (${edge.via})`);
  }
  say();

  const clients = openClients();

  try {
    if (args.apply && !args.force) {
      const existing = await clients.auth.organization.count();

      if (existing > 0) {
        throw new Error(
          `postgres_auth already holds ${existing} organization(s). This seeder is ADDITIVE — a second run doubles the demo and pushes the first run's tenants over their seat limits. Re-run with --force --seed=<a different number>, or reset with 'npm run db:reset'.`,
        );
      }
    }

    // **`--force` and determinism pull against each other, and the collision is
    // guaranteed rather than likely.** The factories' counters reset in a fresh
    // process and `faker.seed()` replays the same draws, so a second run at the
    // same seed regenerates the FIRST run's slugs exactly — and `slug` is
    // globally unique. Left alone, that surfaces as a unique-constraint
    // violation three factories deep, which reads as a factory bug.
    //
    // Measured, not predicted: re-running `--apply --force` at the default seed
    // failed on `org-1-gmpjqj`, the slug the previous run had already written.
    if (args.apply && args.force) {
      const previous = safeManifestSeed();

      // **Compared against what the last run actually used**, not against the
      // default. Scoped to `DEFAULT_SEED` this covered only the case that
      // happened to be hit first: `--force --seed=99` twice collides exactly
      // the same way, and the manifest already records which seed produced the
      // rows now in the database.
      if (previous !== undefined && previous === args.seed) {
        throw new Error(
          `--force at seed ${args.seed} would regenerate the previous run's tenants exactly — the last run used that seed, and same seed + same counters means the same slugs, which are globally unique. Pass --seed=<a different number>.`,
        );
      }
    }

    const manifest: Manifest =
      args.only && args.only !== 'auth'
        ? readManifest()
        : {
            seed: args.seed,
            profile: args.profile,
            generatedAt: new Date().toISOString(),
            tenants: [],
          };

    for (const step of STEPS) {
      if (args.only && args.only !== step.service) continue;

      say(`── ${step.service}`);

      const lines = await step.run({
        manifest,
        profile,
        apply: args.apply,
        clients,
      });

      lines.forEach((line) => say(`   ${line}`));

      // Written after each step rather than once at the end, so a run that
      // fails at ingestion still leaves `--only=ingestion` something to resume
      // from — which is most of why the manifest exists.
      if (args.apply) {
        manifest.generatedAt = new Date().toISOString();
        writeManifest(manifest);
      }

      say();
    }

    say(
      args.apply
        ? `Seeded. Manifest at .demo-seed/manifest.json — every demo user's password is the one in auth.step.ts.`
        : 'Dry run — nothing written. Re-run with --apply.',
    );
  } finally {
    await clients.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
