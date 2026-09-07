import { ORGANIZATION_SLUG_PATTERN } from '@synapsedesk/common';
import {
  CODE_HASH_PARAMS,
  generateBackupCode,
  generateBackupCodes,
  generateUniqueOrganizationSlug,
  hashCode,
  hashToken,
  maskEmail,
  normalizeBackupCode,
  safeCompareHex,
  verifyCode,
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

describe('hashCode / verifyCode (unit)', () => {
  it('round trips, and rejects a wrong code', async () => {
    const stored = await hashCode('123456');

    await expect(verifyCode('123456', stored)).resolves.toBe(true);
    await expect(verifyCode('654321', stored)).resolves.toBe(false);
  });

  it('SALTS — two hashes of one code differ, which is the whole point', async () => {
    // This is exactly the property `hashToken` must NOT have. It is affordable
    // here because neither call site looks a code up by its hash: both fetch
    // the candidate rows first and then compare.
    expect(await hashCode('123456')).not.toBe(await hashCode('123456'));
  });

  it('stores the parameters it used, so a future change can still read old rows', async () => {
    const { N, r, p } = CODE_HASH_PARAMS;

    expect(await hashCode('123456')).toMatch(
      new RegExp(`^scrypt\\$N=${N},r=${r},p=${p}\\$[\\w-]+\\$[\\w-]+$`),
    );
  });

  it('verifies a LEGACY SHA-256 row — a year of backup codes is on paper', async () => {
    // `BACKUP_CODE_TTL_DAYS` is 365 in `.env.example`. Codes issued before the
    // switch cannot be rewritten (a hash does not invert), so this arm carries
    // them until they expire or are regenerated.
    await expect(verifyCode('123456', hashToken('123456'))).resolves.toBe(true);
    await expect(verifyCode('999999', hashToken('123456'))).resolves.toBe(
      false,
    );
  });

  it('treats an UNRECOGNIZED stored value as no match, never a throw', async () => {
    // A throw on this path becomes a 500 on what was only a wrong code, and
    // stub values do reach it: `users.e2e-spec.ts` seeds `codeHash:
    // 'stub-hash'` on a row it never verifies.
    await expect(verifyCode('123456', 'stub-hash')).resolves.toBe(false);
    await expect(verifyCode('123456', '')).resolves.toBe(false);
    await expect(verifyCode('123456', 'scrypt$bogus$a$b')).resolves.toBe(false);
    await expect(
      verifyCode('123456', 'scrypt$N=16384,r=8,p=1$$'),
    ).resolves.toBe(false);
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

describe('generateUniqueOrganizationSlug (unit)', () => {
  it('**emits only slugs the shared pattern accepts** — the producer half of the contract', () => {
    // `ORGANIZATION_SLUG_PATTERN` is the contract between this generator
    // (registration writes a slug with NO DTO in the path) and the gateway's
    // validators (every later edit). A value emitted here and rejected there
    // is an organization that cannot be edited without changing a field its
    // admin never chose — and the symptom appears on a `PATCH` months later.
    //
    // Lowercasing the input first mirrors every real call site
    // (`normalizeEmail` in `auth.service.register`, `.toLowerCase()` in
    // `firebase.service.verifyGoogleIdToken`) — the safety lives in the CALL
    // SITES, and this pins the round trip so a third caller that forgets is
    // caught here rather than in production.
    for (const email of [
      'bob@acme.com',
      'Bob@ACME.COM',
      'someone@sub.example.co.uk',
      'user@a-b.io',
    ]) {
      const slug = generateUniqueOrganizationSlug(email.toLowerCase());

      expect([email, ORGANIZATION_SLUG_PATTERN.test(slug)]).toEqual([
        email,
        true,
      ]);
    }
  });
});
