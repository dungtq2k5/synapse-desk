import { ApiPropertyOptional } from '@nestjs/swagger';
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
  OCR_LANGUAGES,
  DOCUMENT_FLAG_SEVERITIES,
  MAX_FLAG_RESOLUTION_COMMENT_LENGTH,
  DOCUMENT_FLAG_TYPES,
  DocumentFlagSeverity,
  DocumentFlagType,
  DOCUMENT_STATUSES,
  DocumentStatus,
  MAX_DOCUMENT_BYTES,
  MAX_OCR_LANGUAGES,
  normalizeStringArray,
  MAX_DOCUMENT_TITLE_LENGTH,
  MAX_OBJECT_PATH_LENGTH,
  lowerIfString,
  trimIfString,
  type AllowedDocumentMimeType,
  type OcrLanguage,
  DOCUMENT_FILE_TYPES,
  type DocumentFileType,
} from '@synapsedesk/common';
import { AtMostOneNonLatinScript } from '../../../../common/decorators/at-most-one-non-latin-script.decorator';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import {
  MAX_DOCUMENT_DEPARTMENTS,
  MAX_UPLOAD_FILE_NAME_LENGTH,
} from '../../../../common/config/dto.config';

export class PresignDocumentDto {
  // Mirrored from storage-service's `PURPOSE_POLICY[DOCUMENT]`. Widen BOTH:
  // this one only saves a network hop, that one is the real check.
  /** The document's MIME type. Must be one the parser accepts. */
  @IsIn(ALLOWED_DOCUMENT_MIME_TYPES)
  readonly contentType!: AllowedDocumentMimeType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES)
  readonly sizeBytes!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_UPLOAD_FILE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fileName!: string;
}

export class ConfirmDocumentDto {
  // Deliberately not shape-validated: storage-service checks it against the
  // `PendingUpload` it recorded, which is an authorization check, not a
  // syntactic one. A regex here would only reject well-formed paths.
  /** The object path, echoed back from the presign response. */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OBJECT_PATH_LENGTH)
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
  @ApiPropertyOptional()
  readonly isOrganizationWide: boolean = true;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENT_DEPARTMENTS)
  @IsUUID('4', { each: true })
  @ApiPropertyOptional()
  readonly departmentIds: string[] = [];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_UPLOAD_FILE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fileName?: string;

  /**
   * ISO 639-1 codes for OCR, if the uploader knows them.
   *
   * An advanced field: leave it empty unless the upload is known to be scanned.
   * `[]` and absent are the same thing, and the parser falls back to `eng`.
   */
  @IsOptional()
  // **Lower-cased and de-duplicated before validation**, order preserved.
  //
  // Case: BCP 47 defines language tags as case-insensitive and merely
  // conventionally lower-case, so `VI` is not a mistake a caller can see —
  // without this it is a 400. The worse half is anything that reaches the parser
  // without passing through here: `TESSERACT_CODE_BY_LANGUAGE['VI']` is
  // `undefined`, gets filtered out, and the document is silently OCR'd in
  // English.
  //
  // Duplicates: `tesseract -l eng+eng` exits 0, so nothing downstream would ever
  // complain — but `['vi','vi','vi','vi']` spends the whole `MAX_OCR_LANGUAGES`
  // budget on one language, and that cap is a CPU bound. `@ArrayUnique` would
  // instead 400 a request whose intent is unambiguous.
  //
  // Order is preserved because this list is an ordered PREFERENCE: English first
  // on a Vietnamese document measured 2.41% character error against 0.00%.
  @Transform(normalizeStringArray)
  @IsArray()
  // Four, from the measurement recorded at `MAX_OCR_LANGUAGES` — extra
  // languages cost time rather than accuracy, so the cap is a CPU bound.
  @ArrayMaxSize(MAX_OCR_LANGUAGES)
  @IsIn(OCR_LANGUAGES, { each: true })
  @AtMostOneNonLatinScript()
  @ApiPropertyOptional()
  readonly ocrLanguages: OcrLanguage[] = [];
}

/**
 * The body of `POST /documents/:id/replace` — `ConfirmDocumentDto` minus the
 * fields a replacement does not set.
 *
 * No title, scope or department ids: replace swaps the FILE and leaves the
 * document's identity alone. `PATCH /documents/:id` and
 * `PUT /documents/:id/departments` are the routes for those.
 */
export class ReplaceDocumentDto {
  // No `contentType` and no `sizeBytes`, here or on `ConfirmDocumentDto`: both
  // are read back from the object's own metadata at confirm. On the wire they
  // would be numbers the caller invented about a file the caller uploaded.

  // Deliberately not shape-validated, exactly as on `ConfirmDocumentDto`:
  // storage-service checks it against the `PendingUpload` it recorded, which is
  // an authorization check rather than a syntactic one.
  /** The object path, echoed back from the presign response. */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_OBJECT_PATH_LENGTH)
  readonly objectPath!: string;

  /**
   * ISO 639-1 codes for OCR, if the uploader knows them.
   *
   * Re-declared rather than inherited, and NOT carried over from the document
   * being replaced: reading a scan in the wrong language is one of the main
   * reasons to replace one, so the previous value is exactly what a caller may
   * be here to change. Absent means `[]`, which is the `eng` fallback — the
   * same meaning it has on confirm.
   */
  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(MAX_OCR_LANGUAGES)
  @IsIn(OCR_LANGUAGES, { each: true })
  @AtMostOneNonLatinScript()
  @ApiPropertyOptional()
  readonly ocrLanguages: OcrLanguage[] = [];
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
   * Replacement rather than add/remove because the fan-out ordering (
   * The fan-out ordering turns on whether a change restricts, and that is answerable from a
   * before/after pair but not from a stream of deltas applied in unknown order.
   */
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENT_DEPARTMENTS)
  @IsUUID('4', { each: true })
  readonly departmentIds!: string[];
}

export class ListDocumentsQueryDto extends SearchPaginationDto {
  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  readonly status?: DocumentStatus;

  @IsOptional()
  @IsUUID('4')
  readonly departmentId?: string;

  @IsOptional()
  @IsIn(DOCUMENT_FILE_TYPES)
  // The stored values are lowercase, so `?fileType=PDF` would otherwise 400 on
  // a filter the caller spelled reasonably. `@IsIn` still owns the SET.
  @Transform(lowerIfString)
  readonly fileType?: DocumentFileType;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeDeleted: boolean = false;
}

/**
 * The body all three resolve routes share.
 *
 * One DTO rather than three: `dismiss`, `fixed` and `replaced` differ in the
 * resolution the ROUTE supplies, never in what the client sends. The rule that
 * `dismiss` requires a comment is enforced in ingestion-service, where the
 * write is — a `@IsNotEmpty` here could only express it by splitting this into
 * two shapes.
 */
export class ResolveDocumentFlagDto {
  @IsOptional()
  @IsString()
  // `@MaxLength` measures what this produced. Transformation is a separate
  // pass — `plainToInstance` before the validators, whatever order the
  // decorators sit in — so without this a comment exactly at the cap with a
  // trailing newline is a 400 the caller cannot see the cause of.
  @Transform(trimIfString)
  @MaxLength(MAX_FLAG_RESOLUTION_COMMENT_LENGTH)
  @ApiPropertyOptional({ maxLength: MAX_FLAG_RESOLUTION_COMMENT_LENGTH })
  readonly comment?: string;
}

/**
 * The flag worklist filter.
 *
 * `type` accepts EVERY member of `DocumentFlagType` and any number of them.
 * `UNRETRIEVED` and `UNCITED` were once one flag under a name that fitted only
 * the first, and a filter that offered only `UNCITED` would quietly re-merge
 * them: the type nobody can select is the type nobody sees.
 */
export class ListDocumentFlagsQueryDto extends SearchPaginationDto {
  // `detectedAt`, because the base default is `createdAt` and the service
  // allowlists exactly one sortable column here. Left unoverridden, a request
  // with NO query parameters at all — every default call from the UI — would
  // 400.
  override sortBy: string = 'detectedAt';

  @IsOptional()
  // A single `?type=UNCITED` arrives as a string, not an array. Normalising
  // here rather than in the client keeps `@IsIn` meaningful for both shapes.
  @Transform(
    ({ value }) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value], // NOSONAR
  )
  @IsArray()
  @IsIn(DOCUMENT_FLAG_TYPES, { each: true })
  @ApiPropertyOptional()
  readonly type: DocumentFlagType[] = [];

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeResolved: boolean = false;

  @IsOptional()
  @IsIn(DOCUMENT_FLAG_SEVERITIES)
  @ApiPropertyOptional()
  readonly severity?: DocumentFlagSeverity;

  @IsOptional()
  @IsUUID('4')
  @ApiPropertyOptional()
  readonly documentId?: string;
}
