import { PROFILE_NAMES, type ProfileName } from './profiles';
import { STEPS, type SeedService } from './registry';

/**
 * @file Argument parsing, separated from `main()` so it can be tested.
 *
 * `index.ts` runs the seeder on import — a spec cannot reach anything declared
 * beside `main()` without executing it, which is why the parser lives here.
 */

export const DEFAULT_SEED = 20_260_101;

export type Args = {
  apply: boolean;
  force: boolean;
  profile: ProfileName;
  only?: SeedService;
  seed: number;
};

export function parseArgs(argv: string[]): Args {
  const value = (name: string): string | undefined =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

  const profile = (value('profile') ?? 'demo') as ProfileName;
  if (!PROFILE_NAMES.includes(profile)) {
    throw new Error(
      `Unknown profile '${profile}'. One of: ${PROFILE_NAMES.join(', ')}`,
    );
  }

  const services = STEPS.map((step) => step.service);
  const only = value('only') as SeedService | undefined;
  if (only && !services.includes(only)) {
    throw new Error(`Unknown step '${only}'. One of: ${services.join(', ')}`);
  }

  // **A bad `--seed` is refused rather than coerced.** `Number('abc')` is
  // `NaN`, `faker.seed(NaN)` does not throw, and the run is silently
  // non-deterministic — losing the one property the flag exists to control, in
  // the one mode where nobody would notice.
  // The RAW string, so `--seed=` is caught too: `Number('')` is `0`, which is
  // perfectly finite and not what somebody who typed a bare `--seed=` meant.
  const rawSeed = value('seed');
  const seed = rawSeed === undefined ? DEFAULT_SEED : Number(rawSeed);
  if (rawSeed === '' || !Number.isFinite(seed)) {
    throw new Error(
      `--seed must be a number; got '${rawSeed}'. A non-numeric seed silently makes the run non-deterministic.`,
    );
  }

  return {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
    profile,
    only,
    seed,
  };
}

/** What a guard needs to know about the databases before an `--apply`. */
export type SeedState = {
  /** Organizations already in `postgres_auth`. */
  organizations: number;
  /** The seed the previous run used, from its manifest; absent with none. */
  previousSeed: number | undefined;
};

/**
 * Why this run must not apply, or `null`.
 *
 * Both guards protect against minting tenants: a second full run doubles the
 * demo, and `--force` at the previous seed regenerates its slugs, which are
 * unique. **A `--only` run of any step but `auth` mints none** (it reads the
 * last run's manifest), so neither applies to it; a step that would double
 * its own rows refuses through `rerunRefusal` instead.
 *
 * @example applyRefusal(parseArgs(['--apply', '--only=analytics']), { organizations: 5, previousSeed: DEFAULT_SEED }) // null
 */
export function applyRefusal(args: Args, state: SeedState): string | null {
  if (!args.apply) return null;
  if (args.only && args.only !== 'auth') return null;

  if (!args.force && state.organizations > 0) {
    return `postgres_auth already holds ${state.organizations} organization(s). This seeder is ADDITIVE — a second run doubles the demo and pushes the first run's tenants over their seat limits. Re-run with --force --seed=<a different number>, or reset with 'npm run db:reset'.`;
  }
  if (args.force && state.previousSeed === args.seed) {
    return `--force at seed ${args.seed} would regenerate the previous run's tenants exactly — the last run used that seed, and same seed + same counters means the same slugs, which are globally unique. Pass --seed=<a different number>.`;
  }

  return null;
}

/**
 * Why a step that writes its rows once must not run again, or `null`.
 *
 * @example rerunRefusal('ticket', 152) // "The ticket step already wrote 152 row(s) …"
 */
export function rerunRefusal(
  service: SeedService,
  existing: number,
): string | null {
  if (existing === 0) return null;

  return `The ${service} step already wrote ${existing} row(s) for the manifest's tenants; running it again would double them. Reset with 'npm run db:reset' and seed again.`;
}
