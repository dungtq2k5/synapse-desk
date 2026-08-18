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
 * `./graphql/`; `document-response.contract.spec.ts` checks the two agree and
 * records `fileUrl` and `deletedById` as deliberate REST-only fields.
 */
export class DocumentResponseDto {
  id!: string;
  organizationId!: string;
  createdById!: string;
  title!: string;
  /** An internal object path today; a signed URL only via `/download`. */
  fileUrl!: string;
  /**
   * The stored EXTENSION — `pdf`, `txt`, `md` — never the MIME type.
   *
   * `bin` is a real member: any accepted type with no extension mapping is
   * filed under it, as is a value this build does not recognise.
   */
  fileType!: DocumentFileType;
  /**
   * ISO 639-1 codes the uploader declared for OCR.
   *
   * `[]` means "not specified" — never `null`, so absent and empty are one
   * value all the way to the client.
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
  /** The flagged document's title, joined in so the list reads as a worklist. */
  documentTitle!: string;
  /**
   * What kind of attention this document needs, or `null` when the value is one
   * this build does not recognise — the same nullability
   * {@link DocumentResponseDto.status} carries, and for the same reason.
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

/** The departments a single document is scoped to. */
export class DocumentDepartmentsResponseDto {
  readonly departmentIds!: string[];
}
