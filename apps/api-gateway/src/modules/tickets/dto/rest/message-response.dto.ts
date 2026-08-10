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
 * **REST only.** The schema's `type TicketMessage` is
 * `TicketMessageResponseGqlDto` in `../graphql/`; `message-response.contract.spec.ts`
 * checks the two agree, and records `attachments` as a deliberate REST-only
 * field — the URLs are internal object paths, so publishing them in a schema
 * would advertise the storage layout and hand clients a value that does not
 * work.
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

/**
 * A presigned direct-to-storage upload.
 *
 * Here rather than in `messages-grpc.client.ts`, where it was declared and
 * exported beside the client that returns it. A DTO in a client file is a shape
 * two controllers import from a place that describes a transport — and the
 * documents module already has this exact pair in its own `dto/rest/`
 * (`PresignDocumentResponseDto`, `DownloadDocumentResponseDto`), which is the
 * convention this now follows in name as well as in location.
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
