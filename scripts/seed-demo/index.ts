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
import { applyRefusal, parseArgs, rerunRefusal } from './args';
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
    const refusal = applyRefusal(args, {
      organizations:
        args.apply && (!args.only || args.only === 'auth')
          ? await clients.auth.organization.count()
          : 0,
      previousSeed: safeManifestSeed(),
    });
    if (refusal) throw new Error(refusal);

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

      const context = { manifest, profile, apply: args.apply, clients };
      if (args.apply && step.existingRows) {
        const twice = rerunRefusal(
          step.service,
          await step.existingRows(context),
        );
        if (twice) throw new Error(twice);
      }

      const lines = await step.run(context);

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
        ? `Seeded. Manifest at .demo-seed/manifest.json — every demo user's password is SEED_DEMO_PASSWORD, or the one in auth.step.ts without it.`
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
