import {
  IngestionJobResponse,
  toProtoIngestionJobStatus,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { IngestionJob } from '../../generated/prisma/client';

/** Prisma row -> wire. */
export function toIngestionJobResponse(
  job: IngestionJob,
): IngestionJobResponse {
  return {
    id: job.id,
    documentId: job.documentId,
    bullmqJobId: job.bullmqJobId,
    status: toProtoIngestionJobStatus(job.status),
    // proto3 has no null for a scalar; the gateway's DTO restores it.
    errorLog: job.errorLog ?? '',
    processedAt: toProtoTimestamp(job.processedAt),
    createdAt: toProtoTimestamp(job.createdAt),
  };
}
