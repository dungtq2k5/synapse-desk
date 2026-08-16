import {
  AttachmentResponse,
  fromProtoTimestamp,
  MessageResponse,
  requireProtoTimestamp,
  fromProtoMessageAnswerStatus,
} from '@synapsedesk/grpc-proto';
import {
  AttachmentResponseDto,
  MessageResponseDto,
} from './dto/rest/message-response.dto';

export function toAttachmentResponseDto(
  attachment: AttachmentResponse,
): AttachmentResponseDto {
  return {
    id: attachment.id,
    messageId: attachment.messageId,
    fileName: attachment.fileName,
    fileUrl: attachment.fileUrl,
    fileSizeBytes: attachment.fileSizeBytes,
    mimeType: attachment.mimeType,
    createdAt: requireProtoTimestamp(attachment.createdAt, 'createdAt'),
  };
}

export function toMessageResponseDto(
  message: MessageResponse,
): MessageResponseDto {
  return {
    id: message.id,
    ticketId: message.ticketId,
    senderId: message.senderId ?? null,
    content: message.content,
    isAiGenerated: message.isAiGenerated,
    isInternalNote: message.isInternalNote,
    modelName: message.modelName ?? null,
    // `?? null`, not `|| null`: a legitimately zero token count is a real
    // reading, and `||` would erase it into "we did not measure".
    promptTokens: message.promptTokens ?? null,
    completionTokens: message.completionTokens ?? null,
    editedAt: fromProtoTimestamp(message.editedAt) ?? null,
    redactedAt: fromProtoTimestamp(message.redactedAt) ?? null,
    createdAt: requireProtoTimestamp(message.createdAt, 'createdAt'),
    attachments: (message.attachments ?? []).map(toAttachmentResponseDto),
    excludedFromAiContext: message.excludedFromAiContext,
    answerStatus: fromProtoMessageAnswerStatus(message.answerStatus),
  };
}
