import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  DOCUMENT_STATUSES,
  DocumentStatus,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_TITLE_LENGTH,
  trimIfString,
} from '@synapsedesk/common';
import { SearchPaginationBase } from '../../../../common/dto/base/search-pagination-base.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { MAX_DOCUMENT_DEPARTMENTS } from '../../../../common/config/app.config';

export class PresignDocumentDto {
  /**
   * The allowlist, mirrored from storage-service's `PURPOSE_POLICY[DOCUMENT]`.
   *
   * Two layers on purpose: this one refuses a 50 MB `.exe` before it costs a
   * network hop and documents the limit in the API contract; that one holds no
   * matter which service is asking. Widen BOTH when the parser handles more.
   */
  @IsIn(ALLOWED_DOCUMENT_MIME_TYPES)
  readonly contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES)
  readonly sizeBytes!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(trimIfString)
  readonly fileName!: string;
}

export class ConfirmDocumentDto {
  /**
   * Echoed back from the presign response.
   *
   * Not shape-validated here: ingestion-service passes it to storage-service,
   * which checks it against the `PendingUpload` it recorded — a real
   * authorization check rather than a syntactic one. A regex here would only
   * reject well-formed paths that were never authorized, which is the case the
   * real check catches better.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  readonly objectPath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_DOCUMENT_TITLE_LENGTH)
  @Transform(trimIfString)
  readonly title!: string;

  /**
   * Defaults TRUE, matching RDM Table 17.
   *
   * The permissive default is deliberate and worth stating: a knowledge base
   * whose documents defaulted to invisible would look broken to everyone who
   * did not also configure departments, and the failure mode of the other
   * default — a document nobody can find — is a support ticket rather than a
   * disclosure. Restricting is then an explicit act.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly isOrganizationWide?: boolean = true;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENT_DEPARTMENTS)
  @IsUUID('4', { each: true })
  readonly departmentIds?: string[] = [];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimIfString)
  readonly fileName?: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_DOCUMENT_TITLE_LENGTH)
  @Transform(trimIfString)
  readonly title?: string;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly isOrganizationWide?: boolean;
}

export class SetDocumentDepartmentsDto {
  /**
   * The FULL replacement set, not a delta.
   *
   * Replacement rather than add/remove because the fan-out ordering (11-doc
   * §1.4b) turns on whether a change restricts, and that is answerable from a
   * before/after pair but not from a stream of deltas applied in unknown order.
   */
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENT_DEPARTMENTS)
  @IsUUID('4', { each: true })
  readonly departmentIds!: string[];
}

export class ListDocumentsQueryDto extends SearchPaginationBase {
  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  readonly status?: DocumentStatus;

  @IsOptional()
  @IsUUID('4')
  readonly departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  readonly fileType?: string;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly includeDeleted?: boolean = false;
}
