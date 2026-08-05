import { DocumentStatus } from '@synapsedesk/common';

export class DocumentResponseDto {
  id!: string;
  organizationId!: string;
  createdById!: string;
  title!: string;
  /** An internal object path today; a signed URL only via `/download`. */
  fileUrl!: string;
  fileType!: string;
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
