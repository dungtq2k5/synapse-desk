import {
  isForeignKeyViolation,
  isRecordNotFound,
  isUniqueConstraintViolation,
} from './prisma-errors';

/**
 * The P2002 matcher, tested against BOTH shapes Prisma produces.
 *
 * This file exists because the two-shape problem was found the expensive way:
 * a partial unique index fired correctly in Postgres, `isUniqueConstraintViolation`
 * returned false because it only read `meta.target`, and a clean 409 surfaced
 * as an unhandled 500. Nothing failed at compile time and nothing logged a
 * warning — the helper simply answered "no" to a question it could not see.
 *
 * The fixtures below are VERBATIM shapes captured from a real client, not
 * invented ones. An invented fixture would have agreed with the broken code.
 */
describe('isUniqueConstraintViolation (unit)', () => {
  /** Prisma WITHOUT a driver adapter: a raw-SQL index reports its name here. */
  const legacyRawIndexError = {
    code: 'P2002',
    meta: { target: 'documents_org_hash_key' },
  };

  /** Prisma WITHOUT a driver adapter: `@@unique` reports FIELD names. */
  const legacyDeclaredError = {
    code: 'P2002',
    meta: { target: ['organizationId', 'fileHash'] },
  };

  /**
   * Prisma 7 WITH a driver adapter — what this repo actually produces.
   *
   * `target` is absent entirely; the name lives inside the driver's own error
   * message. Captured from postgres_ingestion, unedited apart from shortening.
   */
  const adapterError = {
    code: 'P2002',
    meta: {
      modelName: 'Document',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          originalMessage:
            'duplicate key value violates unique constraint "documents_org_hash_key"',
          kind: 'UniqueConstraintViolation',
          constraint: { fields: ['organization_id', 'file_hash'] },
        },
      },
    },
  };

  it('matches a raw-SQL index name under the ADAPTER shape', () => {
    // The case that was broken. Everything else in this file passed already.
    expect(
      isUniqueConstraintViolation(adapterError, 'documents_org_hash_key'),
    ).toBe(true);
  });

  it('matches a raw-SQL index name under the LEGACY shape', () => {
    expect(
      isUniqueConstraintViolation(
        legacyRawIndexError,
        'documents_org_hash_key',
      ),
    ).toBe(true);
  });

  it('matches a field name under the legacy declared shape', () => {
    expect(isUniqueConstraintViolation(legacyDeclaredError, 'fileHash')).toBe(
      true,
    );
  });

  it('DISTINGUISHES two indexes over the same columns', () => {
    // The reason `constraint.fields` is not consulted. Both indexes below cover
    // (organization_id, file_hash); matching on columns would make them
    // indistinguishable, and telling them apart is the entire purpose of the
    // `index` argument.
    expect(
      isUniqueConstraintViolation(adapterError, 'documents_org_slug_key'),
    ).toBe(false);
  });

  it('returns true for ANY P2002 when no index is named', () => {
    expect(isUniqueConstraintViolation(adapterError)).toBe(true);
    expect(isUniqueConstraintViolation(legacyRawIndexError)).toBe(true);
  });

  it('returns false for a different Prisma error code', () => {
    expect(
      isUniqueConstraintViolation({ code: 'P2003' }, 'documents_org_hash_key'),
    ).toBe(false);
  });

  it('returns false for things that are not Prisma errors at all', () => {
    // Duck-typed on purpose: each service generates its OWN Prisma client, so
    // `instanceof` would be false across service boundaries. The cost of that
    // choice is that anything vaguely error-shaped reaches here, so the
    // non-errors have to be handled explicitly.
    for (const value of [null, undefined, 'P2002', 42, new Error('boom'), {}]) {
      expect([value, isUniqueConstraintViolation(value, 'x')]).toEqual([
        value,
        false,
      ]);
    }
  });

  it('survives a meta whose nested shape is missing pieces', () => {
    // A partially-populated `meta` is what a future Prisma release most likely
    // produces, and an optional-chain gap here would throw inside a catch
    // block — turning a handled 409 into a crash while handling an error.
    const shapes = [
      { code: 'P2002', meta: {} },
      { code: 'P2002', meta: { driverAdapterError: {} } },
      { code: 'P2002', meta: { driverAdapterError: { cause: {} } } },
      { code: 'P2002', meta: { target: 42 } },
    ];

    for (const shape of shapes) {
      expect(() => isUniqueConstraintViolation(shape, 'x')).not.toThrow();
      expect(isUniqueConstraintViolation(shape, 'x')).toBe(false);
    }
  });
});

describe('the other Prisma error matchers (unit)', () => {
  it('isForeignKeyViolation matches P2003 only', () => {
    expect(isForeignKeyViolation({ code: 'P2003' })).toBe(true);
    expect(isForeignKeyViolation({ code: 'P2002' })).toBe(false);
  });

  it('isRecordNotFound matches P2025 only', () => {
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true);
    expect(isRecordNotFound({ code: 'P2002' })).toBe(false);
  });
});
