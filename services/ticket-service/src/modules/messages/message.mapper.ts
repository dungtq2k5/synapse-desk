import {
  AttachmentResponse,
  MessageCitations,
  MessageResponse,
  toProtoTimestamp,
  toProtoMessageAnswerStatus,
} from '@synapsedesk/grpc-proto';
import {
  MessageAttachment,
  Prisma,
  TicketMessage,
} from '../../generated/prisma/client';

export type MessageWithAttachments = TicketMessage & {
  attachments?: MessageAttachment[];
};

export function toAttachmentResponse(
  attachment: MessageAttachment,
): AttachmentResponse {
  return {
    id: attachment.id,
    messageId: attachment.messageId,
    fileName: attachment.fileName,
    // An internal object PATH, not a public URL — the column holds a storage
    // key, and whatever resolves it to a signed URL does so per request. See
    // Object paths are storage-service's contract.
    fileUrl: attachment.fileUrl,
    fileSizeBytes: Number(attachment.fileSizeBytes),
    mimeType: attachment.mimeType,
    createdAt: toProtoTimestamp(attachment.createdAt),
  };
}

export function toMessageResponse(
  message: MessageWithAttachments,
): MessageResponse {
  return {
    id: message.id,
    ticketId: message.ticketId,
    senderId: message.senderId ?? undefined,
    content: message.content,
    isAiGenerated: message.isAiGenerated,
    isInternalNote: message.isInternalNote,
    modelName: message.modelName ?? undefined,
    promptTokens: message.promptTokens ?? undefined,
    completionTokens: message.completionTokens ?? undefined,
    editedAt: toProtoTimestamp(message.editedAt),
    redactedAt: toProtoTimestamp(message.redactedAt),
    createdAt: toProtoTimestamp(message.createdAt),
    // `?? []` rather than leaving it undefined: proto3 repeated fields are
    // never null, and a caller that fetched without the relation should get an
    // empty list rather than a crash on `.map`.
    attachments: (message.attachments ?? []).map(toAttachmentResponse),
    // **On the read shape so the gateway can filter after fetching**
    // Its transcript builder drops these rows itself rather than asking for
    // a filtered list, because the same route serves the UI where a refused
    // message must stay visible.
    excludedFromAiContext: message.excludedFromAiContext,
    answerStatus: toProtoMessageAnswerStatus(message.answerStatus),
    citations: fromStoredCitations(message.citations),
  };
}

/**
 * One citation as `ticket_messages.citations` stores it.
 *
 * Five keys on every entry, whichever path wrote the row. `pageNumber` is
 * `null`, never absent, for a format with no pages.
 */
// **A STORAGE format, not the gateway's `CitationResponseDto`**, though the
// two match field for field today. That class is in another app and cannot
// be imported from here — ticket-service depends on `common` and `grpc-proto`
// only. They are also separate contracts: rows already in this column must
// keep parsing (`isStoredCitation`) whatever the REST shape does next, and
// they already differ in scope — a draft's REST response drops
// `vectorPointId`, which this column keeps. The proto sits between the two,
// and each side's mapping is typechecked against it.
export type StoredCitation = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  vectorPointId: string;
};

/**
 * The column value for a list of citations.
 *
 * Structural input, so both writers call it: `appendAiMessage` hands it the
 * proto's `DraftCitation` (page number optional), the auto-reply hands it
 * `AiReplyDraft`'s (page number nullable).
 *
 * @example
 * toStoredCitations(request.citations.items)
 * // [{ chunkId, documentId, documentTitle, pageNumber: null, vectorPointId }]
 */
export function toStoredCitations(
  citations: ReadonlyArray<{
    chunkId: string;
    documentId: string;
    documentTitle: string;
    pageNumber?: number | null;
    vectorPointId: string;
  }>,
): StoredCitation[] {
  return citations.map((citation) => ({
    chunkId: citation.chunkId,
    documentId: citation.documentId,
    documentTitle: citation.documentTitle,
    pageNumber: citation.pageNumber ?? null,
    vectorPointId: citation.vectorPointId,
  }));
}

/**
 * The wire value for a stored `citations` column, keeping NULL and `[]` apart.
 *
 * Returns `undefined` for a NULL column (a human message, or an AI row written
 * before citations were stored) and `{ items: [] }` for an answer that cited
 * nothing. An entry that is not a {@link StoredCitation} is dropped rather
 * than filled in.
 *
 * @example
 * fromStoredCitations(null); // undefined
 * fromStoredCitations([]);   // { items: [] }
 */
export function fromStoredCitations(
  value: Prisma.JsonValue | null,
): MessageCitations | undefined {
  if (!Array.isArray(value)) return undefined;

  return {
    items: value.filter(isStoredCitation).map((citation) => ({
      chunkId: citation.chunkId,
      documentId: citation.documentId,
      documentTitle: citation.documentTitle,
      pageNumber: citation.pageNumber ?? undefined,
      vectorPointId: citation.vectorPointId,
    })),
  };
}

function isStoredCitation(value: unknown): value is StoredCitation {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.chunkId === 'string' &&
    typeof candidate.documentId === 'string' &&
    typeof candidate.documentTitle === 'string' &&
    (candidate.pageNumber === null ||
      typeof candidate.pageNumber === 'number') &&
    typeof candidate.vectorPointId === 'string'
  );
}
