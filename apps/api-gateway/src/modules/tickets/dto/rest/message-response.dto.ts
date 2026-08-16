import { AnswerStatus } from '@synapsedesk/common';
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

// ASK This `docblock` seems to be invalid
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
  /**
   * Kept OUT of AI prompts
   *
   * Exposed rather than stripped: the transcript builder in `AiStreamService`
   * filters on it AFTER fetching, because the same route serves the UI, where a
   * refused message stays visible.
   */
  excludedFromAiContext!: boolean;
  // ASK This `docblock` seems to be invalid
  /**
   * What the generation concluded — null for a human message.
   *
   * The FIXME here asked for the enum "if it's right", and it was: the
   * vocabulary existed in two protos and in no TypeScript at all, so there was
   * nothing to name. `AnswerStatus` in `@synapsedesk/common` is that name now,
   * and `message.mapper.ts` narrows the wire value through the shared bridge —
   * null covers both a human message and a status this build cannot name.
   */
  answerStatus!: AnswerStatus | null;
}

/**
 * What a create answers with
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
