import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AuditAction, AuditResourceType } from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';

export class ListAuditLogsQueryDto extends SearchPaginationDto {
  // ASK this `docblock` seem to be invalid
  /**
   * `@IsIn`, where this used to be a free string — and the comment explaining
   * why it was free is worth keeping, because it was right until the wire
   * changed.
   *
   * It said: the catalogue grows in whichever service publishes an action, so a
   * gateway enum would 400 a brand-new action the moment a service started
   * emitting it. **That premise no longer holds.** `action` is a proto enum now,
   * so a value outside `AuditAction` cannot cross the wire at all — the gateway
   * and ticket-service generate from the same declaration and cannot disagree
   * except while one is mid-deploy.
   *
   * What DID change is the failure mode, and it flipped to the worse side. An
   * unknown string used to reach an equality filter and match nothing, which is
   * the honest answer. Converted to an enum it becomes UNSPECIFIED — which means
   * "no filter" — so `?action=SOME_FUTURE_ACTION` would quietly return
   * EVERYTHING. A caller reading that as "these are the SOME_FUTURE_ACTION
   * events" is the exact failure `listDocumentFlags` refuses by throwing.
   *
   * 400 is the honest answer to a filter this build cannot apply.
   */
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
