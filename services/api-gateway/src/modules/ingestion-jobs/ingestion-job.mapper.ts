import {
  IngestionJobResponse,
  ListIngestionJobsRequest,
  ListIngestionJobsResponse,
  fromProtoIngestionJobStatus,
  fromProtoTimestamp,
  requireProtoTimestamp,
  toPageRequest,
  toProtoIngestionJobStatus,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { ListIngestionJobsQueryDto } from './dto/rest/ingestion-job.dto';
import { IngestionJobResponseDto } from './dto/rest/ingestion-job-response.dto';

/**
 * How much of `error_log` a REST client is given.
 *
 * Long enough for a real parser or storage message, short enough that a
 * thrower which embeds a payload cannot deliver much of one.
 */
const ERROR_LOG_MAX_CHARS = 500;

/**
 * `error_log`, capped.
 *
 * `fail()` writes whatever the thrower said — signed storage URLs, Postgres
 * errors quoting column values, embedding-API 4xx bodies that echo a prefix of
 * the rejected input. This route hands that to any `document.read` holder.
 *
 * **A cap bounds the audience this route has, not the field.** The gRPC
 * `GetIngestionJob` still returns `error_log` in full, so an in-cluster
 * consumer added later gets the raw text. Classifying at the writer — a short
 * operator-safe message on the row, the full text to the logger — is the actual
 * fix, and it is a separate change because it moves what is stored.
 */
function toErrorLog(errorLog: string): string | null {
  // '' on the wire is proto3's absent scalar; REST commits to null.
  if (!errorLog) return null;

  return errorLog.length > ERROR_LOG_MAX_CHARS
    ? `${errorLog.slice(0, ERROR_LOG_MAX_CHARS)}…`
    : errorLog;
}

/** Converts the REST query into its wire request. */
export function toListIngestionJobsRequest(
  query: ListIngestionJobsQueryDto,
): ListIngestionJobsRequest {
  return {
    // UNSPECIFIED and '' are what the service reads as "no filter".
    status: toProtoIngestionJobStatus(query.status),
    documentId: query.documentId ?? '',
    page: toPageRequest(query),
  };
}

/**
 * Converts an `IngestionJobResponse` off the wire into its REST DTO.
 *
 * @throws Error if `createdAt` is missing, which the proto requires.
 */
export function toIngestionJobResponseDto(
  job: IngestionJobResponse,
): IngestionJobResponseDto {
  return {
    id: job.id,
    documentId: job.documentId,
    bullmqJobId: job.bullmqJobId,
    // `| null` rather than a fallback, matching `DocumentResponseDto.status`:
    // inventing a member here would report a status the peer never sent.
    status: fromProtoIngestionJobStatus(job.status),
    errorLog: toErrorLog(job.errorLog),
    processedAt: fromProtoTimestamp(job.processedAt) ?? null,
    createdAt: requireProtoTimestamp(job.createdAt, 'createdAt'),
  };
}

/** Converts a `ListIngestionJobsResponse` into the paginated REST envelope. */
export function toIngestionJobPageDto(
  response: ListIngestionJobsResponse,
): PaginationResponseDto<IngestionJobResponseDto> {
  return {
    items: response.items.map(toIngestionJobResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}
