package com.synapsedesk.gateway.messages;

import java.time.OffsetDateTime;

/**
 * `{ uploadUrl, objectPath, expiresAt }` — both presign routes' actual
 * shape, named rather than left as {@code ApiResponse<Object>} or borrowing
 * `AuthControllerForgotPasswordV1202Response`. No {@code
 * PresignAttachmentResponseDto} model was generated for this shape — a
 * generator artifact, not a real coupling to auth — so it is hand-written
 * here, matching Node's DTO field-for-field.
 */
public record PresignAttachmentResponseDto(
  String uploadUrl,
  String objectPath,
  OffsetDateTime expiresAt
) {}
