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
  DOCUMENT_FLAG_TYPES,
  DocumentFlagType,
  DOCUMENT_STATUSES,
  DocumentStatus,
  MAX_DOCUMENT_BYTES,
  MAX_OCR_LANGUAGES,
  normalizeStringArray,
  MAX_DOCUMENT_TITLE_LENGTH,
  trimIfString,
} from '@synapsedesk/common';
import { AtMostOneNonLatinScript } from '../../../../common/decorators/at-most-one-non-latin-script.decorator';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { MAX_DOCUMENT_DEPARTMENTS } from '../../../../common/config/dto.config';

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

  /**
   * ISO 639-1 codes for OCR, if the uploader knows — 34-doc §4.
   *
   * **Empty on almost every upload, and that is inherent**: nobody knows their
   * PDF is scanned until it is parsed, which is the premise of the whole
   * feature. So this is an escape hatch for the tenant who knows they are
   * uploading scanned Vietnamese forms — an advanced field in the UI, never a
   * question asked of every upload.
   *
   * Unspecified falls back to `eng` at the parser. `[]` and absent are the same
   * thing all the way down, because Prisma scalar lists cannot be null.
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
  readonly ocrLanguages?: string[] = [];
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

export class ListDocumentsQueryDto extends SearchPaginationDto {
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

/**
 * The flag worklist filter — 16-doc §5.
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
  @Transform(({ value }) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @IsIn(DOCUMENT_FLAG_TYPES, { each: true })
  readonly type?: DocumentFlagType[];

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly includeResolved?: boolean = false;
}
