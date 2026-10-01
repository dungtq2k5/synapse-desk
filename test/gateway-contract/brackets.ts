/**
 * @file Balanced-bracket scanning, shared by every regex reader in this
 * directory that has to find where a construct ENDS rather than just where
 * it starts.
 *
 * **Why this exists.** `[^)]*\)` and `[^>]*>` both stop at the FIRST closing
 * character, which is only correct when nothing between the open and the
 * real close repeats that character — true of `rowFor('A', 'B')` and
 * `ResponseEntity<FooResponse>`, false the moment either nests: `@Query(()
 * => Type, {...})`'s own parameter list, or `ResponseEntity<ApiResponse<T>>`'s
 * envelope. Each of those was found the same way — a flat-nesting scan
 * silently under-matching real code — so this is the second (and now third)
 * time the fix has been the same function, extracted rather than
 * re-derived.
 */

/**
 * The index of the closing bracket matching the opening one at `openIndex`,
 * tracking nesting depth. `source[openIndex]` must be `open`.
 *
 * @returns -1 if the brackets never balance before the source ends.
 */
export function matchingBracketIndex(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    if (source[index] === open) depth++;
    else if (source[index] === close) {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}
