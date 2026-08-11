import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Who is allowed to construct a Redis connection — 29-doc §2.
 *
 * The doc's premise was *"seven `new Redis(...)` sites, replace them with one"*.
 * Read as written that is wrong in three places, and each is wrong for a reason
 * worth keeping rather than a detail worth fixing — so the list below is the
 * corrected version, pinned.
 *
 * **The concern the doc actually names is an EIGHTH ad-hoc client**, and a count
 * that only ever goes up is not caught by review. This is.
 */
const SRC = join(__dirname, '../..');

/** Every `.ts` under `src/`, excluding specs. */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) out.push(path);
  }

  return out;
};

/**
 * Source with comments removed.
 *
 * Without this the sweep flags `throttler.config.ts`, whose docblock explains
 * why it does NOT pass `new Redis(...)` — a file caught for describing the rule
 * it follows. A scan that cannot tell code from prose reports the careful files
 * and teaches everyone to add an exemption.
 */
const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Redis connections', () => {
  const constructors = () =>
    walk(SRC)
      .filter((path) => /new Redis\(/.test(code(path)))
      .map((path) => path.slice(SRC.length + 1))
      .sort();

  it('**only the shared provider and its three exceptions construct a client**', () => {
    // Sorted, so this reads as a set rather than as an order somebody has to
    // preserve.
    expect(constructors()).toEqual([
      // A pub/sub PAIR. A client in subscriber mode may issue no other
      // commands, so the subscriber cannot be the shared one — and
      // `createAdapter` wants a matched pair whose lifetime is the adapter's.
      'common/adapters/redis-io.adapter.ts',

      // The shared connection. Everything that can share, shares.
      'common/redis/redis.service.ts',

      // The OPPOSITE options, deliberately: one attempt, a command timeout, and
      // no offline queue. On the shared client the probe would buffer its
      // command through an outage and report UP the moment Redis returned,
      // having reported nothing while it was down.
      'modules/health/redis-health.service.ts',
    ]);
  });

  it('and the throttler is handed a URL, never an instance', () => {
    // The third exception, and the only one that does NOT appear above —
    // because it constructs nothing itself. `ThrottlerStorageRedisService`
    // closes the connection only when it built it, so passing an instance leaks
    // it past shutdown: harmless in a pod, and exactly what makes a test
    // process hang after `app.close()` with no visible cause.
    //
    // Asserted so that "consolidate the last one" does not look like tidying.
    const source = readFileSync(
      join(SRC, 'common/config/throttler.config.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /new ThrottlerStorageRedisService\(\s*configService\.getOrThrow<string>\('REDIS_URL'\)/,
    );
  });

  it('and the sweep sees files at all', () => {
    // Guards the guard: a walk that returns nothing reports "no stray clients"
    // exactly as confidently as a clean tree does.
    expect(walk(SRC).length).toBeGreaterThan(100);
  });
});
