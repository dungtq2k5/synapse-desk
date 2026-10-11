package com.synapsedesk.gateway.modules.roles.dto.graphql;

import com.synapsedesk.gateway.modules.roles.RolesResolver;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * `Role` — `permissionCodes` doubles as the input to the `permissions` edge
 * ({@code RolesResolver.permissions} filters the tenant catalogue against
 * it), so the type stays flat.
 */
public record RoleGqlDto(
  String id,
  String name,
  String description,
  boolean isSystemRole,
  int userAssigned,
  List<String> permissionCodes,
  OffsetDateTime createdAt,
  OffsetDateTime updatedAt
) {}
