import {
  AttachmentResponse,
  CreateMessageResponse,
  DownloadAttachmentResponse,
  fromProtoMessageAnswerStatus,
  fromProtoTimestamp,
  ListAttachmentsResponse,
  ListMessagesResponse,
  MessageResponse,
  PresignAttachmentResponse,
  requireField,
  requireProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import {
  CreateMessageResponseDto,
  DownloadAttachmentResponseDto,
  PresignAttachmentResponseDto,
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
    attachments: message.attachments.map(toAttachmentResponseDto),
    excludedFromAiContext: message.excludedFromAiContext,
    answerStatus: fromProtoMessageAnswerStatus(message.answerStatus),
  };
}

/** Converts a `ListMessagesResponse` into the paginated REST envelope. */
export function toMessagePageDto(
  response: ListMessagesResponse,
): PaginationResponseDto<MessageResponseDto> {
  return {
    items: response.items.map(toMessageResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `CreateMessageResponse` off the wire into its REST DTO.
 *
 * `skippedAttachments` names files that never confirmed — routinely non-empty
 * for an honest caller, since a presign record lives ten minutes.
 *
 * @throws Error if the response carries no message, which the proto requires.
 */
export function toCreateMessageResponseDto(
  response: CreateMessageResponse,
): CreateMessageResponseDto {
  return {
    message: toMessageResponseDto(requireField(response.message, 'message')),
    skippedAttachments: response.skippedAttachments,
  };
}

/** Converts a `ListAttachmentsResponse` off the wire into its REST DTOs. */
export function toAttachmentResponseDtos(
  response: ListAttachmentsResponse,
): AttachmentResponseDto[] {
  return response.items.map(toAttachmentResponseDto);
}

/**
 * Converts a `PresignAttachmentResponse` off the wire into its REST DTO.
 *
 * @throws Error if `expiresAt` is missing, which the proto requires.
 */
export function toPresignAttachmentResponseDto(
  response: PresignAttachmentResponse,
): PresignAttachmentResponseDto {
  return {
    uploadUrl: response.uploadUrl,
    objectPath: response.objectPath,
    expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
  };
}

/**
 * Converts a `DownloadAttachmentResponse` off the wire into its REST DTO.
 *
 * @throws Error if `expiresAt` is missing — a signed URL with no expiry is a
 * contract violation, and defaulting it would hand the client a dead URL.
 */
export function toDownloadAttachmentResponseDto(
  response: DownloadAttachmentResponse,
): DownloadAttachmentResponseDto {
  return {
    downloadUrl: response.downloadUrl,
    expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
  };
}
