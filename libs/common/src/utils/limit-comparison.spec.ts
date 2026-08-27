import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scans FROM the code TOWARD the rule: every size comparison against a resolved
 * limit goes through `exceedsLimit`.
 *
 * `limits.spec.ts` proves the guard refuses a `NaN` ceiling. It cannot prove
 * anyone CALLS it — a site that quietly returns to a bare `>` is back to the
 * silent-unlimited failure with every one of those tests still green. The
 * direction matters: scanning from a registry of known call sites would only
 * catch a site that was renamed, never one that was rewritten.
 */
describe('Size comparisons go through the guard', () => {
  const REPO = join(__dirname, '../../../..');
  const SERVICES = [
    'apps/api-gateway/src',
    'apps/auth-service/src',
    'apps/ingestion-service/src',
    'apps/storage-service/src',
    'apps/ticket-service/src',
    'apps/notification-service/src',
  ];

  /**
   * A comparison of some measured quantity against a resolved ceiling.
   *
   * Deliberately shaped to the NAMES rather than to the types: what makes a
   * comparison dangerous is that the right-hand side arrived through a `min()`
   * over layers, and that is legible in `…Limit`, `…Bytes`, `max…` far more
   * reliably than in any type.
   */
  const DANGEROUS =
    /(?:^|[\s(!])([A-Za-z_][A-Za-z0-9_.]*(?:[sS]izeBytes|[bB]ytes|\.length))\s*>=?\s*([A-Za-z_][A-Za-z0-9_.]*(?:Limit|LimitBytes|maxBytes|maxSizeBytes|maxPerMessage|MAX_[A-Z_]+))/;

  /**
   * Comparisons that are NOT a tenant limit check.
   *
   * Each is a bare comparison whose right-hand side is a compile-time constant
   * that no composition can turn into `NaN`. They are listed rather than
   * pattern-matched so that adding one is a decision somebody made.
   */
  const SANCTIONED = new Set<string>([
    'apps/api-gateway/src/modules/ingestion-jobs/ingestion-job.mapper.ts',
  ]);

  const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'generated' && entry.name !== 'node_modules') {
            walk(path);
          }
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.includes('.spec.')
        ) {
          out.push(path);
        }
      }
    };
    for (const service of SERVICES) walk(join(REPO, service));

    return out;
  };

  it('1. **the scan reads a real corpus**', () => {
    // The vacuity guard, and the reason it is test 1. A scan over zero files
    // reports exactly what a clean repo reports, so without a floor here every
    // assertion below passes the moment a path goes wrong. Three variants of
    // this shape have now appeared in this project — an empty match set, an
    // empty file list, and a test run that compiled nothing. All three pass by
    // finding nothing.
    const files = sources();

    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.includes('messages.service.ts'))).toBe(
      true,
    );
  });

  it('2. **no service compares a size against a limit with a bare `>`**', () => {
    const offenders: string[] = [];

    for (const file of sources()) {
      const relative = file.slice(REPO.length + 1);
      if (SANCTIONED.has(relative)) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (DANGEROUS.test(line)) {
          offenders.push(`${relative}:${index + 1} — ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('3. and the sanctioned list has not gone stale', () => {
    // A sanctioned path that no longer exists is a reader being told a rule has
    // an exception it does not have.
    const all = sources().map((file) => file.slice(REPO.length + 1));

    for (const sanctioned of SANCTIONED) {
      expect(all).toContain(sanctioned);
    }
  });

  it('4. **the pattern actually fires** — proven on the code it is written for', () => {
    // Without this the suite is one bad regex away from being decorative:
    // test 2 passes for a pattern that matches nothing at all, which is the
    // same vacuity as an empty corpus wearing different clothes.
    expect(DANGEROUS.test('if (request.sizeBytes > sizeLimitBytes) {')).toBe(
      true,
    );
    expect(DANGEROUS.test('if (file.sizeBytes > limits.maxBytes) {')).toBe(
      true,
    );
    expect(
      DANGEROUS.test('if (uploads.length >= limits.maxPerMessage) {'),
    ).toBe(true);
    expect(
      DANGEROUS.test('if (request.sizeBytes > policy.maxSizeBytes) {'),
    ).toBe(true);
    // …and does NOT fire on the guarded form that replaced them.
    expect(
      DANGEROUS.test('if (exceedsLimit(request.sizeBytes, sizeLimitBytes)) {'),
    ).toBe(false);
  });
});
