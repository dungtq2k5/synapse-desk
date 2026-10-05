/**
 * What the gateway's two date rules do with a value, shared by the specs that hold a
 * date field to one of them.
 */

export type Rule = { accepted: string[]; refused: string[] };

/**
 * `@IsISO8601({ strict: true })` (validator.js): a calendar date, a timestamp with or
 * without an offset (`Z` or `+0700`), a space instead of the `T`, the basic form, a week
 * date and an ordinal date are all accepted. A date that does not exist, a day or month
 * without its leading zero, a leading space and the empty string are not.
 */
export const ISO: Rule = {
  accepted: [
    '2026-01-01',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00',
    '2026-01-01T00:00:00+0700',
    '2026-01-01 00:00',
    '20260101',
    '2026-W01',
    '2026-001',
  ],
  refused: ['not-a-date', '2026-02-30', '2026-1-1', ' 2026-01-01', ''],
};

/** `@Matches(ISO_DATE_PATTERN)`: the shape only, so a date that does not exist passes. */
export const PATTERN: Rule = {
  accepted: ['2026-01-01', '2026-02-30'],
  refused: [
    'not-a-date',
    '2026-01-01T00:00:00Z',
    '20260101',
    '2026-1-1',
    ' 2026-01-01',
    '',
  ],
};
