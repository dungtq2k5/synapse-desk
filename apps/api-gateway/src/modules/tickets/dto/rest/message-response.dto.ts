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
 * `redactedAt` non-null means `content` is the placeholder, not what was
 * written — a client showing "[message removed]" as ordinary text would be
 * misleading, so the flag travels alongside it rather than being inferred from
 * the string.
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
}
