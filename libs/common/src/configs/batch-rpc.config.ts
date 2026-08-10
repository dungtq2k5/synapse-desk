/**
 * How many ids one `ListXByIds` call may carry — 27-doc §1, property 5.
 *
 * **Without a cap, `first: 100` nested twice is one RPC asking for ten thousand
 * rows.** A cap turns a slow, hard-to-attribute outage into a fast, obvious
 * failure with the offending query named in the error.
 *
 * **And it must be an ERROR, never a truncation.** A truncated batch returns
 * fewer rows than were asked for, which is indistinguishable from those rows
 * having been deleted — so the page renders with silent gaps and nothing
 * anywhere reports a problem.
 */
export const BATCH_ID_LIMIT = 200;

/**
 * The chunk cap, deliberately lower — 27-doc §3.
 *
 * A chunk carries its whole text, so these are the largest payloads in the
 * system by a wide margin: 200 of them is megabytes on the wire where 200 users
 * is kilobytes. The cap is about bytes, not rows, and one number for both would
 * be wrong for one of them.
 */
export const BATCH_CHUNK_LIMIT = 50;

/**
 * Rejects an over-cap batch, and normalises the ids.
 *
 * Deduplicates as it goes — property 3. DataLoader dedups its own keys, but a
 * caller may not, and `IN (…)` collapsing duplicates in the database does not
 * stop a caller sending 400 ids of which 200 are distinct: the cap must judge
 * what was ASKED for, or it is trivially bypassed by repetition.
 */
export function normalizeBatchIds(
  ids: readonly string[] | undefined,
  limit: number = BATCH_ID_LIMIT,
): { ids: string[]; overLimit: boolean } {
  const requested = ids ?? [];

  if (requested.length > limit) return { ids: [], overLimit: true };

  return { ids: [...new Set(requested)], overLimit: false };
}
