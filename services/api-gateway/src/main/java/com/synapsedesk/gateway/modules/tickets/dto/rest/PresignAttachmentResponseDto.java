package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.synapsedesk.gateway.common.dto.UploadMethod;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;

/**
 * `{ uploadUrl, objectPath, expiresAt }` — both presign routes' actual
 * shape, named rather than left as {@code ApiResponse<Object>}.
 *
 * <p><b>{@code @NotNull} documents here; it does not validate.</b> Nothing checks an
 * outgoing body, so on this type the annotation only tells the published document
 * that the property is required and never null (see {@code
 * ResponseSchemasOpenApiCustomizer}, which publishes a response property without it
 * as possibly null). It is not redundant: removing it changes the published
 * contract.
 */
public record PresignAttachmentResponseDto(
  @NotNull String uploadUrl,
  /** How to send the bytes to {@code uploadUrl}: see {@link UploadMethod}. */
  @NotNull UploadMethod uploadMethod,
  @NotNull String objectPath,
  @NotNull OffsetDateTime expiresAt
) {}
