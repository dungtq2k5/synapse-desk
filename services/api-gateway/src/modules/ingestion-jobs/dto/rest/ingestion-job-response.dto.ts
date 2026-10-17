import {
  IngestionErrorCode,
  IngestionJobStatus,
  IngestionStage,
  IngestionWaitingReason,
} from '@synapsedesk/contracts';

/** One ingestion attempt, as the pipeline worklist shows it. */
export class IngestionJobResponseDto {
  id!: string;
  documentId!: string;
  /** Empty until the worker has queued it. */
  bullmqJobId!: string;
  /** `null` only if the peer sent a member this build does not know. */
  status!: IngestionJobStatus | null;
  errorLog!: string | null;
  /**
   * Why a `FAILED` attempt failed, as a reader can act on it: too long, no
   * readable text, OCR unavailable, the AI provider failed, or other.
   * `errorLog` stays the detail. `null` on an attempt that hasn't failed.
   */
  errorCode!: IngestionErrorCode | null;
  /** The stage a `FAILED` attempt was in. `null` on one that hasn't failed. */
  failedStage!: IngestionStage | null;
  /**
   * Why a `QUEUED` attempt waits: `AI_ALLOWANCE` when it was put back because
   * the organization's AI allowance ran out mid-run; it starts again by itself
   * once the allowance resets or the plan changes. `null` is an ordinary queue.
   */
  waitingReason!: IngestionWaitingReason | null;
  /** `null` while the attempt is still running. */
  processedAt!: Date | null;
  createdAt!: Date;
}
