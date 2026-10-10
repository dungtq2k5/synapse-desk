/** @file `@Transform` helpers. Each leaves a non-matching value alone for the validators to reject. */

/**
 * Trims, LOWER-CASES and de-duplicates a string array, preserving order.
 *
 * A `@Transform`, so it runs BEFORE the validators — `@IsIn(...)` and
 * `@ArrayMaxSize(...)` should judge the value that will actually be stored.
 *
 * **The lower-casing is in the contract**, which is why this is not for every
 * array. It suits case-INSENSITIVE identifier lists — language codes, email
 * addresses, tags — and would quietly break an array of enum members:
 * `DOCUMENT_FLAG_TYPES` are upper-case, and running them through here turns
 * every one into a value `@IsIn` rejects.
 *
 * **De-duplication makes a size cap mean what it says**: `@ArrayMaxSize(4)`
 * over `['vi','vi','vi','vi']` otherwise passes while expressing one choice.
 *
 * **Order survives, and for some callers that is load-bearing** — `Set` iterates
 * in insertion order. `ocrLanguages` is an ordered preference, where naming
 * English first on a Vietnamese document scored 2.41% character error against
 * 0.00% the other way round.
 *
 * Anything that is not an array of strings passes through untouched.
 */
export function normalizeStringArray({ value }: { value: unknown }): unknown {
  if (!Array.isArray(value)) return value;
  if (!value.every((entry) => typeof entry === 'string')) return value;

  return [...new Set(value.map((entry) => entry.trim().toLowerCase()))];
}

/**
 * Trims a string value, leaving anything else alone for the validators to
 * reject.
 *
 * Trimming BEFORE validation is the point: without it `"  "` satisfies
 * `@MinLength(2)` and reaches the service as an empty name.
 */
export function trimIfString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Lowercases a string value, leaving anything else alone for the validators to
 * reject.
 *
 * For a field whose allowed set is lowercase — `DOCUMENT_FILE_TYPES` is `pdf`,
 * `txt`, `md` — so that `?fileType=PDF` filters rather than 400s. Pair it with
 * the `@IsIn` that owns the set; this only normalizes the case.
 */
export function lowerIfString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}
