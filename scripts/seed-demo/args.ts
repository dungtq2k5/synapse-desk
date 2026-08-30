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
