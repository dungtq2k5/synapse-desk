import { IsIn, IsUUID } from 'class-validator';
import {
  IngestionJobStatus,
  INGESTION_JOB_STATUSES,
} from '@synapsedesk/contracts';
import { PaginationDto } from '../../../../common/dto/rest/pagination.dto';
import { OptionalNonNull } from '../../../../common/decorators/optional.decorator';

/** Query for `GET /ingestion-jobs`. */
export class ListIngestionJobsQueryDto extends PaginationDto {
  @OptionalNonNull()
  @IsIn(INGESTION_JOB_STATUSES)
  readonly status?: IngestionJobStatus;

  @OptionalNonNull()
  @IsUUID()
  readonly documentId?: string;
}
