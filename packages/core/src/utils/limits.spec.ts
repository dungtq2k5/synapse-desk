import { exceedsLimit } from './limits';

/**
 * The chain this guard exists to break, pinned as arithmetic first and as
 * behaviour second — so it stays true if the guard is rewritten.
 */
describe('exceedsLimit', () => {
  it('1. compares like `>` for every usable limit', () => {
    expect(exceedsLimit(5_000_000, 2_000_000)).toBe(true);
    expect(exceedsLimit(1_000_000, 2_000_000)).toBe(false);
    // The boundary is NOT over. A file exactly at the limit is admitted, which
    // is what every call site already assumed.
    expect(exceedsLimit(2_000_000, 2_000_000)).toBe(false);
    // Zero is a usable limit and refuses everything above it — the loud
    // failure direction, and reachable honestly from a plan grant of zero.
    expect(exceedsLimit(1, 0)).toBe(true);
    expect(exceedsLimit(0, 0)).toBe(false);
  });

  it('2. **REFUSES a NaN limit, which bare `>` would wave through**', () => {
    // The whole point, in two lines. The bare comparison says a 5 MB file is
    // not over the limit — not because it is small, but because every
    // comparison against NaN is false.
    expect(5_000_000 > Math.min(10_000_000, Number(undefined))).toBe(false);
    expect(() => exceedsLimit(5_000_000, Number(undefined))).toThrow(
      /unusable limit/,
    );
  });

  it('3. and refuses the other two unusable shapes', () => {
    // Infinity is not a ceiling, and a negative one can only mean the
    // composition went wrong. Neither is reachable from any input.
    expect(() => exceedsLimit(1, Infinity)).toThrow(/unusable limit/);
    expect(() => exceedsLimit(1, -1)).toThrow(/unusable limit/);
  });

  it('4. **both known routes to NaN are stopped by the same guard**', () => {
    // The argument for guarding here rather than at each route: these two
    // arrive from unrelated places — a missing `??` fallback, and a proto
    // loader option in a file that mentions no file size — and neither can
    // reach a caller through this function.
    const missingFallback = Math.min(104_857_600, Number(undefined));
    const absentWireField = Math.min(
      10_485_760,
      undefined as unknown as number,
    );

    expect(missingFallback).toBeNaN();
    expect(absentWireField).toBeNaN();
    expect(() => exceedsLimit(1, missingFallback)).toThrow();
    expect(() => exceedsLimit(1, absentWireField)).toThrow();
  });
});
