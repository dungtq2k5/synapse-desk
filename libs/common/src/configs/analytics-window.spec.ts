import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_ANALYTICS_RANGE_DAYS,
  resolveAnalyticsRangeDays,
} from './analytics.config';
import { parseAnalyticsRange } from '../utils/analytics-range';

/**
 * The analytics window, pinned ACROSS both services that enforce it.
 *
 * **This cannot live inside either service.**
 * `ai-analytics.service.ts` and `analytics.service.ts` each
 * guard their own `parseRange`, and each suite asserts against what its own
 * service resolved — so two green suites are perfectly compatible with two
 * different answers for one tenant. The failure is DIVERGENCE, so the guard has
 * to see both sides at once, and the only place that does is here.
 *
 * The composition is shared (`resolveAnalyticsRangeDays`) precisely so the two
 * cannot differ by arithmetic. What this file adds is proof that both still
 * call it — a service that inlined its own `Math.min` would pass every test it
 * owns.
 */
describe('The analytics window resolves identically in both services', () => {
  const REPO = join(__dirname, '../../../..');

  const GUARDS = [
    'apps/ingestion-service/src/modules/analytics/ai-analytics.service.ts',
    'apps/ticket-service/src/modules/analytics/analytics.service.ts',
  ];

  const RESOLVERS = [
    'apps/ingestion-service/src/modules/auth-client/auth-reference.service.ts',
    'apps/ticket-service/src/modules/auth-client/auth-reference.service.ts',
  ];

  const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');

  it('1. **the scan reads all four files** — no path has drifted', () => {
    // The vacuity guard, asserted PER GROUP: a marker absent from both groups
    // would make every check below pass over nothing. `readFileSync` throws on
    // a bad path, so the substring is what proves the file is the one meant
    // rather than merely a file.
    for (const path of GUARDS) {
      expect(read(path)).toContain('parseAnalyticsRange');
    }
    for (const path of RESOLVERS) {
      expect(read(path)).toContain('async getAnalyticsRangeDays');
    }
  });

  it('2. **both resolvers call the SHARED composition** — neither inlines its own', () => {
    // The mutation this file exists for: one service quietly computing its own
    // window. Its suite would stay green, and a tenant would see different
    // history depending on which page they opened.
    for (const path of RESOLVERS) {
      const source = read(path);

      expect(source).toContain('resolveAnalyticsRangeDays');
      // And does NOT re-derive it: a local `Math.min` against the constant is
      // exactly the shape that drifts.
      expect(source).not.toMatch(/Math\.min\(\s*MAX_ANALYTICS_RANGE_DAYS/);
    }
  });

  it('3. **neither service parses a range of its own any more**', () => {
    // Stronger than what this test asserted when the two services each owned a
    // private `parseRange`: they now call ONE implementation, so the windows
    // cannot differ by arithmetic at all. What is left to check is that neither
    // has grown a local copy back — which is exactly how the duplication
    // arrived the first time.
    for (const path of GUARDS) {
      const source = read(path);

      expect(source).toContain('parseAnalyticsRange(');
      expect(source).not.toMatch(/^function parseRange\b/m);
      expect(source).not.toMatch(/^function parseDay\b/m);
      // And no service compares against the platform constant directly: the
      // number is per tenant now, so a guard reading the constant is a service
      // ignoring the plan it was sold.
      expect(source).not.toMatch(/days > MAX_ANALYTICS_RANGE_DAYS/);
    }
  });

  it('3b. **the shared parser actually BOUNDS** — behaviour, not a substring', () => {
    // Test 3 proves both services call one function; it cannot prove that
    // function does anything. And a scan cannot either: measured,
    // `if (false && days > maxRangeDays)` still contains the pattern a source
    // check looks for. So this one runs it.
    //
    // Both services inherit exactly this, which is the point of them sharing it.
    expect(() => parseAnalyticsRange('2026-01-01', '2026-03-01', 30)).toThrow(
      /maximum is 30/,
    );

    // The boundary is INCLUSIVE: a 30-day window admits a 30-day range.
    expect(parseAnalyticsRange('2026-01-01', '2026-01-30', 30)).toEqual({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-30T00:00:00.000Z'),
    });

    // An inverted range is refused before the window is even considered.
    expect(() => parseAnalyticsRange('2026-03-01', '2026-01-01', 400)).toThrow(
      /must not be after/,
    );

    // And a malformed day names WHICH field, so a caller who sent `01/02/2026`
    // is not left guessing.
    expect(() => parseAnalyticsRange('01/02/2026', '2026-01-02', 400)).toThrow(
      /`from`/,
    );
  });

  it('4. the shared composition narrows, bounds, and refuses', () => {
    // The behaviour both services inherit, stated once.
    expect(resolveAnalyticsRangeDays(30)).toBe(30);
    expect(resolveAnalyticsRangeDays(MAX_ANALYTICS_RANGE_DAYS * 20)).toBe(
      MAX_ANALYTICS_RANGE_DAYS,
    );
    expect(resolveAnalyticsRangeDays(MAX_ANALYTICS_RANGE_DAYS)).toBe(
      MAX_ANALYTICS_RANGE_DAYS,
    );
    // **A lost wire field refuses every range rather than widening it** — the
    // same asymmetry the byte grants carry, and the loud direction.
    expect(resolveAnalyticsRangeDays(undefined)).toBe(0);
  });
});
