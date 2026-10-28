/**
 * The end of an edit window that opened at `openedAt`: `minutes` later, or
 * `null` once it has passed. One place for the arithmetic a message's edit,
 * a message's file and the opening's files all read.
 *
 * @example editWindowEnd(new Date(), 15) // 15 minutes from now
 */
export function editWindowEnd(
  openedAt: Date,
  minutes: number,
  now: Date = new Date(),
): Date | null {
  const end = new Date(openedAt.getTime() + minutes * 60_000);
  return end > now ? end : null;
}
