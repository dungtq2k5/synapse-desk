package com.synapsedesk.gateway.messages;

import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

/**
 * `{ uploadUrl, objectPath, expiresAt }` — both presign routes' actual
 * shape, named rather than left as {@code ApiResponse<Object>}. Matches Node's
 * DTO field-for-field.
 */
public record PresignAttachmentResponseDto(
  @NotNull String uploadUrl,
  @NotNull String objectPath,
  @NotNull OffsetDateTime expiresAt
) {}
