import { DocumentStatus } from '@synapsedesk/common';

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
  fileType!: string;
  /**
   * ISO 639-1 codes the uploader declared for OCR — 34-doc §4.
   *
   * `[]` means "not specified", never null: Prisma scalar lists cannot be null,
   * so there is one value for absent and empty all the way to the client.
   *
   * No `@ApiProperty` — this class carries no decorators and the Swagger CLI
   * plugin generates the schema from the type.
   */
  ocrLanguages!: string[];
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
  /**
   * Joined in rather than left to the client.
   *
   * This list is read as a worklist — "which documents need attention" — and a
   * page of uuids is one a reviewer has to resolve by hand before it says
   * anything.
   */
  documentTitle!: string;
  flagType!: string;
  severity!: string;
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
