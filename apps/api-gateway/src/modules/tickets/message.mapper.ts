import {
  AttachmentResponse,
  fromTimestamp,
  MessageResponse,
  requireTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  AttachmentResponseDto,
  MessageResponseDto,
} from './dto/rest/message-response.dto';

export function toAttachmentDto(
  attachment: AttachmentResponse,
): AttachmentResponseDto {
  return {
    id: attachment.id,
    messageId: attachment.messageId,
    fileName: attachment.fileName,
    fileUrl: attachment.fileUrl,
    fileSizeBytes: attachment.fileSizeBytes,
    mimeType: attachment.mimeType,
    createdAt: requireTimestamp(attachment.createdAt, 'createdAt'),
  };
}

export function toMessageDto(message: MessageResponse): MessageResponseDto {
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
    editedAt: fromTimestamp(message.editedAt) ?? null,
    redactedAt: fromTimestamp(message.redactedAt) ?? null,
    createdAt: requireTimestamp(message.createdAt, 'createdAt'),
    attachments: (message.attachments ?? []).map(toAttachmentDto),
  };
}
