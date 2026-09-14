import { AnswerStatus } from '@synapsedesk/common';

/**
 * One passage an AI answer cited.
 *
 * Served on a message's `citations`, on the `ai:stream:done` frame, and on a
 * knowledge answer. A co-pilot draft serves a narrower pick of it —
 * `DraftCitationResponseDto`.
 */
export class CitationResponseDto {
  chunkId!: string;
  documentId!: string;
  documentTitle!: string;
  /**
   * The page this citation points at, or `null` when the source document has no
   * pages — a pasted text file, an HTML article. Never faked as 1.
   */
  pageNumber!: number | null;
  /** The retrieval key the citation resolves through. */
  vectorPointId!: string;
}

export class AttachmentResponseDto {
  id!: string;
  messageId!: string;
  fileName!: string;
  /** An internal object path today; a signed URL once storage-service lands. */
  fileUrl!: string;
  fileSizeBytes!: number;
  mimeType!: string;
  createdAt!: Date;
}

/**
 * A message as the REST API returns it.
 *
 * `attachments` is REST-only: the URLs are internal object paths, so the
 * GraphQL `TicketMessage` deliberately omits them.
 *
 * A non-null `redactedAt` means `content` holds the placeholder rather than
 * what was written — branch on the flag, not on the string.
 */
export class MessageResponseDto {
  id!: string;
  ticketId!: string;
  /** null for an AI-generated message — no user wrote it. */
  senderId!: string | null;
  content!: string;
  isAiGenerated!: boolean;
  isInternalNote!: boolean;
  modelName!: string | null;
  promptTokens!: number | null;
  completionTokens!: number | null;
  editedAt!: Date | null;
  redactedAt!: Date | null;
  createdAt!: Date;
  attachments!: AttachmentResponseDto[];
  /**
   * Kept OUT of AI prompts.
   *
   * Exposed rather than stripped: the transcript builder in `AiStreamService`
   * filters on it AFTER fetching, because the same route serves the UI, where a
   * refused message stays visible.
   */
  excludedFromAiContext!: boolean;
  /**
   * What the generation concluded.
   *
   * `null` for a human message, and also for a status this build cannot name.
   */
  answerStatus!: AnswerStatus | null;
  /**
   * What an AI answer cited.
   *
   * `null` for a human message and for an AI message written before citations
   * were stored; `[]` for an answer that cited nothing.
   */
  citations!: CitationResponseDto[] | null;
}

/**
 * What a create answers with.
 *
 * A wrapper because a create now has a second outcome: an attachment whose
 * confirm failed is **skipped and named**, and the message is created anyway.
 * The presign record lives ten minutes and a user writing a careful ticket
 * around a screenshot takes longer than that often enough — so this list is
 * routinely non-empty for an honest caller, not only for a forged path.
 *
 * Never merged into {@link MessageResponseDto}: every read would then carry a
 * field only a create can populate.
 */
export class CreateMessageResponseDto {
  message!: MessageResponseDto;
  /**
   * File NAMES, never object paths and never contents — the same rule the AI's
   * own skipped list follows, and for the same reason: a user reads this.
   */
  skippedAttachments!: string[];
}

/**
 * A presigned direct-to-storage upload for a message attachment.
 *
 * The message-module counterpart of {@link PresignDocumentResponseDto}.
 */
export class PresignAttachmentResponseDto {
  uploadUrl!: string;
  objectPath!: string;
  expiresAt!: Date;
}

/** A short-lived signed URL for reading one attachment. */
export class DownloadAttachmentResponseDto {
  downloadUrl!: string;
  expiresAt!: Date;
}
