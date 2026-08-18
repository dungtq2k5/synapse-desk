/** @file Comparators for stable, human-readable ordering. */

/**
 * The comparator for sorting strings alphabetically.
 *
 * `Array.prototype.sort()` with no argument compares by UTF-16 code unit, not
 * alphabetically — `'Z'` sorts before `'a'`. For the ASCII identifiers most
 * call sites pass the two agree, which is what makes the bare form easy to
 * reach for and easy to get wrong the first time a value is a display name, a
 * slug, or anything a user typed.
 *
 * @example
 *   [...codes].sort(compareAlphabetically)
 *
 * Note this does NOT copy: `.sort()` still mutates in place. Spread first when
 * the array belongs to something the assertion also inspects.
 */
export function compareAlphabetically(a: string, b: string): number {
  return a.localeCompare(b);
}
