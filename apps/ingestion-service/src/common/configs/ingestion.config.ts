/** @file This service's own ingestion vocabulary — not shared, not persisted. */

/**
 * What one run of `IngestionProcessor.process()` concluded.
 *
 * `as const` with a derived union rather than an `enum`, per
 * `development-conventions.md` §7.3: nothing writes these to a column or puts
 * them on the wire — `ingestion_jobs.status` is {@link IngestionJobStatus} and
 * is a different, finer-grained vocabulary. This one exists so the worker can
 * tell the three endings apart.
 *
 * Local to this service on purpose (§3.1): the processor produces it and the
 * worker reads it, and nothing outside ingestion-service has a use for it.
 */
export const INGESTION_OUTCOMES = {
  /** Chunked, embedded, upserted. The document is retrievable. */
  INDEXED: 'INDEXED',
  /**
   * The tenant is at the AI cap.
   *
   * A SUCCESS to BullMQ: the job row stays `QUEUED` and drains at the cycle
   * roll, because throwing would burn the retry budget and end as `FAILED` —
   * which RDM §1.14 forbids.
   */
  DEFERRED: 'DEFERRED',
  /** The row reached a terminal status underneath the worker. */
  CANCELLED: 'CANCELLED',
} as const;

export type IngestionOutcome =
  (typeof INGESTION_OUTCOMES)[keyof typeof INGESTION_OUTCOMES];
