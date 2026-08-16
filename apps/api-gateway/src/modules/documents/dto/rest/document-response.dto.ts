import {
  DocumentFlagSeverity,
  DocumentStatus,
  type DocumentFileType,
  type DocumentFlagType,
  type OcrLanguage,
} from '@synapsedesk/common';

/**
 * A document as the REST API returns it.
 *
 * **REST only.** The schema's `type Document` is `DocumentResponseGqlDto` in
 * `../graphql/`; `document-response.contract.spec.ts` checks the two agree and
 * records `fileUrl` and `deletedById` as deliberate REST-only fields.
 */
export class DocumentResponseDto {
  id!: string;
  organizationId!: string;
  createdById!: string;
  title!: string;
  /** An internal object path today; a signed URL only via `/download`. */
  fileUrl!: string;
  // ASK this `docblock` seem to be invalid
  /**
   * The stored EXTENSION — `pdf`, `txt`, `md` — never the MIME type.
   *
   * Narrow so the generated OpenAPI carries an `enum` rather than `string`, and
   * so a client can switch on it. `bin` is a member because it is a real stored
   * value: any accepted type with no extension mapping is filed under it, and
   * the mapper falls back to it for a value this build does not recognise.
   */
  fileType!: DocumentFileType;
  // ASK this `docblock` seem to be invalid
  /**
   * ISO 639-1 codes the uploader declared for OCR
   *
   * `[]` means "not specified", never null: Prisma scalar lists cannot be null,
   * so there is one value for absent and empty all the way to the client.
   *
   * No `@ApiProperty` — this class carries no decorators and the Swagger CLI
   * plugin generates the schema from the type.
   */
  ocrLanguages!: OcrLanguage[];
  fileSizeBytes!: number;
  isOrganizationWide!: boolean;
  status!: DocumentStatus | null;
  departmentIds!: string[];
  chunkCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
  deletedById!: string | null;
}

export class DocumentChunkResponseDto {
  id!: string;
  documentId!: string;
  chunkIndex!: number;
  contentText!: string;
  pageNumber!: number | null;
  tokenCount!: number;
  /** null until the Qdrant upsert has written it back — i.e. not yet retrievable. */
  vectorPointId!: string | null;
  createdAt!: Date;
}

export class DocumentFlagResponseDto {
  id!: string;
  documentId!: string;
  // ASK this `docblock` seem to be invalid
  /**
   * Joined in rather than left to the client.
   *
   * This list is read as a worklist — "which documents need attention" — and a
   * page of uuids is one a reviewer has to resolve by hand before it says
   * anything.
   */
  documentTitle!: string;
  // ASK this `docblock` seem to be invalid
  /**
   * `null` when this build does not recognise the value.
   *
   * **Nullable for the same reason `DocumentResponseDto.status` is**, and the
   * two should be read together. A response DTO is never validated — the value
   * arrives from ingestion-service over gRPC — so a narrow non-null type would
   * be a claim nothing enforces. Both sides read `DocumentFlagType` from
   * `@synapsedesk/common`, so they can only disagree while one is a newer
   * deploy than the other; that is precisely when a client is better told
   * "unknown" than handed a string its union does not contain.
   */
  flagType!: DocumentFlagType | null;
  severity!: DocumentFlagSeverity | null;
  detail!: string;
  confidenceScore!: number | null;
  detectedAt!: Date;
}

export class PresignDocumentResponseDto {
  uploadUrl!: string;
  objectPath!: string;
  expiresAt!: Date;
}

export class DownloadDocumentResponseDto {
  downloadUrl!: string;
  expiresAt!: Date;
}

export class StorageUsageResponseDto {
  usedBytes!: number;
  limitBytes!: number;
  documentCount!: number;
}
