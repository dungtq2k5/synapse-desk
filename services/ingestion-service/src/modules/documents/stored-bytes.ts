/**
 * What a tenant's documents hold in storage: each document's live file plus
 * the file a replace left pending.
 *
 * A replace's new file waits in `pending_file_*` until its version is swapped
 * in, and a failed or cancelled update keeps it there so Retry can run it
 * again. It is stored and billed the whole time, so every storage total counts
 * it. Both totals (`usedBytes` and the platform's per-organization usage) sum
 * through these two, so a third total can't forget the pending half.
 *
 * @example
 * const { _sum } = await prisma.document.aggregate({ where, _sum: STORED_BYTES_SUM });
 * storedBytes(_sum) // live + pending, in bytes
 */
export const STORED_BYTES_SUM = {
  fileSizeBytes: true,
  pendingFileSizeBytes: true,
} as const;

/** The two sums added; a missing sum (no rows, no pending file) counts as 0. */
export function storedBytes(sum: {
  fileSizeBytes: bigint | null;
  pendingFileSizeBytes: bigint | null;
}): number {
  return Number((sum.fileSizeBytes ?? 0n) + (sum.pendingFileSizeBytes ?? 0n));
}
