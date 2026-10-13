package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.synapsedesk.gateway.common.dto.UserResponseDto;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * What enabling two-step answers: the backup codes, shown once, and the user it
 * signed in when it was enabled through the sign-in challenge (the session
 * cookies are set with it). {@code user} is null when enabled from a session.
 *
 * <p>{@code @NotNull} documents here; it does not validate (see {@code
 * ResponseSchemasOpenApiCustomizer}).
 */
public record TwoFactorEnabledResponseDto(
  @NotNull List<String> backupCodes,
  UserResponseDto user
) {}
