import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  IngestionJobStatus,
  INGESTION_JOB_STATUSES,
} from '@synapsedesk/common';
import { PaginationDto } from '../../../../common/dto/rest/pagination.dto';

/** Query for `GET /ingestion-jobs`. */
export class ListIngestionJobsQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(INGESTION_JOB_STATUSES)
  readonly status?: IngestionJobStatus;

  @IsOptional()
  @IsUUID()
  readonly documentId?: string;
}
