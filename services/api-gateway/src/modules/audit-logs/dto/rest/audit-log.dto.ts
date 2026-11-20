import { Type } from 'class-transformer';
import { IsIn, IsObject, IsUUID } from 'class-validator';
import { ISO_DATE_PATTERN } from '../../../../common/config/dto.config';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, AuditResourceType } from '@synapsedesk/contracts';
import { PaginationDto } from '../../../../common/dto/rest/pagination.dto';
import { OptionalNonNull } from '../../../../common/decorators/optional.decorator';
import { PublishedMatches } from '../../../../common/decorators/published-validators.decorator';

// **No `searchTerm`, and that is the change.**
//
// It was inherited, advertised in Swagger, accepted, and never used — an audit
// search that returned an unfiltered page reads as "nothing else matched"
// (known-gaps #6). `action` and `resourceType` are already exact filters drawn
// from an allowlist, so there is no free-text column here worth searching.
//
// Extending `PaginationDto` makes the parameter a 400 naming the property
// rather than a silent no-op. Part of the pre-client clearing — see
// `PaginationDto`.
export class ListAuditLogsQueryDto extends PaginationDto {
  // `@IsIn` is load-bearing, not decoration: an unrecognized value maps to the
  // proto's UNSPECIFIED, which the service reads as "no filter" -- so
  // `?action=SOME_FUTURE_ACTION` would return EVERYTHING and read as a match.
  // 400 is the honest answer to a filter this build cannot apply.
  @OptionalNonNull()
  @IsIn(Object.values(AuditAction))
  readonly action?: AuditAction;

  @OptionalNonNull()
  @IsUUID('4')
  readonly userId?: string;

  // Case-sensitive on purpose. A blanket upper-casing transform across the 44
  // `@IsIn` fields would break the ones whose vocabularies are lower-case —
  // `OCR_LANGUAGES` (`en`, `vi`) and `DOCUMENT_FILE_TYPES` (`pdf`, `txt`).
  @OptionalNonNull()
  @IsIn(Object.values(AuditResourceType))
  readonly resourceType?: AuditResourceType;

  @OptionalNonNull()
  @IsUUID('4')
  readonly resourceId?: string;

  @OptionalNonNull()
  @Type(() => Date)
  readonly from?: Date;

  @OptionalNonNull()
  @Type(() => Date)
  readonly to?: Date;
}

/**
 * `POST /audit-logs/export`.
 *
 * The range is required and bounded — `MAX_EXPORT_SPAN_DAYS` at the service —
 * because the byte bound counts rows while a span counts days, and neither
 * alone holds the line.
 */
export class CreateAuditLogExportDto {
  @PublishedMatches(ISO_DATE_PATTERN, {
    message: 'from must be a date (YYYY-MM-DD)',
  })
  readonly from!: string;

  @PublishedMatches(ISO_DATE_PATTERN, {
    message: 'to must be a date (YYYY-MM-DD)',
  })
  readonly to!: string;

  /** `action`, `resourceType`, `userId` — refused per kind at the service. */
  @OptionalNonNull()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  readonly filters?: Record<string, string>;
}
