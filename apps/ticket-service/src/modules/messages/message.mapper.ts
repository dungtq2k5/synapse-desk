import {
  AttachmentResponse,
  MessageResponse,
  toProtoTimestamp,
  toProtoMessageAnswerStatus,
} from '@synapsedesk/grpc-proto';
import {
  MessageAttachment,
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
    // 10-storage-service.md §1.3.
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
    // **On the read shape so the gateway can filter after fetching** — 36-doc
    // §7. Its transcript builder drops these rows itself rather than asking for
    // a filtered list, because the same route serves the UI where a refused
    // message must stay visible.
    excludedFromAiContext: message.excludedFromAiContext,
    answerStatus: toProtoMessageAnswerStatus(message.answerStatus),
  };
}
