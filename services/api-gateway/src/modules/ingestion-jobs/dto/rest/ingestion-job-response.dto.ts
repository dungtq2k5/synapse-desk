import { IngestionJobStatus } from '@synapsedesk/common';

/** One ingestion attempt, as the pipeline worklist shows it. */
export class IngestionJobResponseDto {
  id!: string;
  documentId!: string;
  /** Empty until the worker has queued it. */
  bullmqJobId!: string;
  /** `null` only if the peer sent a member this build does not know. */
  status!: IngestionJobStatus | null;
  errorLog!: string | null;
  /** `null` while the attempt is still running. */
  processedAt!: Date | null;
  createdAt!: Date;
}
