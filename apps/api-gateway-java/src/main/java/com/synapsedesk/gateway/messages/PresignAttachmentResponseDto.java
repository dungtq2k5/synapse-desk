package com.synapsedesk.gateway.messages;

import java.time.OffsetDateTime;

/**
 * `{ uploadUrl, objectPath, expiresAt }` — both presign routes' actual
 * shape, named rather than left as {@code ApiResponse<Object>}. Matches Node's
 * DTO field-for-field.
 */
public record PresignAttachmentResponseDto(
  String uploadUrl,
  String objectPath,
  OffsetDateTime expiresAt
) {}
