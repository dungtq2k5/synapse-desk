import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  IngestionJobStatus,
  INGESTION_JOB_STATUSES,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';

/** Query for `GET /ingestion-jobs`. */
export class ListIngestionJobsQueryDto extends SearchPaginationDto {
  @IsOptional()
  @IsIn(INGESTION_JOB_STATUSES)
  readonly status?: IngestionJobStatus;

  @IsOptional()
  @IsUUID()
  readonly documentId?: string;
}
