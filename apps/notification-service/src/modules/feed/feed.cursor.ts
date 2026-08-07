/**
 * The feed cursor — 18-doc §2.
 *
 * **Cursors, not offsets, and the reason is mechanical rather than stylistic.**
 * The feed grows at the head while it is being read: between the request for
 * page 1 and the request for page 2, three new notifications can arrive. With
 * `OFFSET 20` those three push the rows down, so page 2 re-serves rows the
 * client already has — and nothing about the response says so. The client
 * renders duplicates, or (on a delete) skips a row nobody ever sees.
 *
 * A cursor names a POSITION rather than a distance, so the same rows follow it
 * regardless of what arrived in front.
 *
 * `(created_at, id)` rather than `created_at` alone: two notifications can
 * share a millisecond — group collapse refreshes `created_at` to `NOW()` for a
 * whole fan-out — and a cursor on a non-unique column either repeats or skips
 * every row that ties with it.
 *
 * Opaque to the client, base64 of a JSON pair. Opaque so that changing the sort
 * key later is not a breaking API change, and so nobody starts constructing one
 * by hand.
 */

export type FeedCursor = {
  createdAt: Date;
  id: string;
};

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt.toISOString(), i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Decodes, or returns null for anything that is not a cursor we issued.
 *
 * **Null rather than an error.** A malformed cursor is almost always a stale
 * client or a truncated URL, and answering the first page is a better outcome
 * than a 400 the user cannot act on. The one thing it must not do is fall
 * through into an unfiltered query.
 */
export function decodeCursor(value: string | undefined): FeedCursor | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );

    if (typeof parsed !== 'object' || parsed === null) return null;

    const { t, i } = parsed as { t?: unknown; i?: unknown };
    if (typeof t !== 'string' || typeof i !== 'string') return null;

    const createdAt = new Date(t);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { createdAt, id: i };
  } catch {
    return null;
  }
}

/**
 * The "strictly older than the cursor" predicate, as Prisma's `OR` form.
 *
 * Written out rather than as a raw tuple comparison (`(created_at, id) < (…)`)
 * because Prisma has no expression for row-value comparison — and getting the
 * second clause wrong is the classic off-by-one that drops exactly the rows
 * sharing a timestamp with the page boundary.
 */
export function cursorPredicate(cursor: FeedCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      // The tie-break. Ids are uuids and therefore not ordered by time, but
      // they are ordered CONSISTENTLY, which is all a tie-break needs.
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}
