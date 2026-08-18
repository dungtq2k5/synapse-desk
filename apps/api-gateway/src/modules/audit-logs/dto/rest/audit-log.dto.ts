import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AuditAction, AuditResourceType } from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';

export class ListAuditLogsQueryDto extends SearchPaginationDto {
  // `@IsIn` is load-bearing, not decoration: an unrecognized value maps to the
  // proto's UNSPECIFIED, which the service reads as "no filter" -- so
  // `?action=SOME_FUTURE_ACTION` would return EVERYTHING and read as a match.
  // 400 is the honest answer to a filter this build cannot apply.
  @IsOptional()
  @IsIn(Object.values(AuditAction))
  readonly action?: AuditAction;

  @IsOptional()
  @IsUUID('4')
  readonly userId?: string;

  // Case-sensitive on purpose. A blanket upper-casing transform across the 44
  // `@IsIn` fields would break the ones whose vocabularies are lower-case —
  // `OCR_LANGUAGES` (`en`, `vi`) and `DOCUMENT_FILE_TYPES` (`pdf`, `txt`).
  @IsOptional()
  @IsIn(Object.values(AuditResourceType))
  readonly resourceType?: AuditResourceType;

  @IsOptional()
  @IsUUID('4')
  readonly resourceId?: string;

  @IsOptional()
  @Type(() => Date)
  readonly from?: Date;

  @IsOptional()
  @Type(() => Date)
  readonly to?: Date;
}
