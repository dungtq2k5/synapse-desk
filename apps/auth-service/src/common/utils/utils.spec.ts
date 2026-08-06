import {
  generateBackupCode,
  generateBackupCodes,
  hashToken,
  maskEmail,
  normalizeBackupCode,
  safeCompareHex,
} from './index';

/**
 * Unit tests for the pure helpers, beside the source they cover — no database,
 * no Nest container, nothing to boot.
 *
 * These live here rather than in an e2e suite because they are pure functions:
 * an e2e file would have to stand a whole service up to call one of them, and
 * the failure would be reported three layers away from the arithmetic that
 * actually broke.
 */
describe('backup-code generation (unit)', () => {
  it('12. a generated set contains NO duplicates', () => {
    // Direct test of the Set-based loop. A naive `Array.from({length: n})`
    // could emit the same code twice, which silently reduces the number of
    // recovery attempts a user actually has — and nothing downstream would
    // notice, because a duplicate hash is a perfectly valid row.
    //
    // Repeated, because a collision is probabilistic: a single run passing
    // proves almost nothing.
    for (let run = 0; run < 50; run++) {
      const codes = generateBackupCodes(10);
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
    }
  });

  it('12b. asking for N always yields exactly N', () => {
    for (const n of [1, 5, 10, 25]) {
      expect(generateBackupCodes(n)).toHaveLength(n);
    }
  });

  it('12c. codes are drawn from a large enough space to be worth generating', () => {
    // 200 codes with no collision is a weak but real signal that the alphabet
    // and length are not so small that the `Set` loop would spin.
    const codes = generateBackupCodes(200);
    expect(new Set(codes).size).toBe(200);
  });
});

describe('normalizeBackupCode (unit)', () => {
  it('is case- and format-insensitive — users type these off paper', () => {
    const canonical = normalizeBackupCode(generateBackupCode());

    expect(normalizeBackupCode(canonical.toLowerCase())).toBe(canonical);
    expect(normalizeBackupCode(`  ${canonical}  `)).toBe(canonical);
    expect(
      normalizeBackupCode(`${canonical.slice(0, 4)}-${canonical.slice(4)}`),
    ).toBe(canonical);
  });
});

describe('hashToken (unit)', () => {
  it('is DETERMINISTIC — the property the whole lookup-by-value design rests on', () => {
    // bcrypt salts randomly, so the same token would hash differently every
    // time and could never be found by a unique index. That is why these
    // secrets use SHA-256 and passwords do not.
    expect(hashToken('the-same-token')).toBe(hashToken('the-same-token'));
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('produces a 64-character hex digest, matching the VarChar(64) columns', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('safeCompareHex (unit)', () => {
  it('matches identical digests and rejects different ones', () => {
    const digest = hashToken('token');
    expect(safeCompareHex(digest, digest)).toBe(true);
    expect(safeCompareHex(digest, hashToken('other'))).toBe(false);
  });

  it('rejects a LENGTH mismatch instead of throwing', () => {
    // `timingSafeEqual` throws on unequal buffer lengths, so the guard in front
    // of it is what stops a malformed input becoming a 500 rather than a
    // rejection.
    expect(safeCompareHex(hashToken('token'), 'abc')).toBe(false);
    expect(safeCompareHex('', '')).toBe(false);
  });
});

describe('maskEmail (unit)', () => {
  it('hides the local part — a stolen token must not read addresses back', () => {
    const masked = maskEmail('someone.specific@example.test');

    expect(masked).not.toBe('someone.specific@example.test');
    expect(masked).toContain('*');
    // The domain survives, which is what makes the masked value useful at all:
    // "is this the work address or the personal one?"
    expect(masked).toContain('example.test');
  });
});
