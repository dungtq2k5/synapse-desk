package com.synapsedesk.gateway.roles;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * `Role` — `permissionCodes` doubles as the input to the `permissions` edge
 * ({@code RolesResolver.permissions} filters the tenant catalogue against
 * it), matching `role-response.gql-dto.ts`'s flat shape exactly.
 */
public record RoleGqlDto(
    String id,
    String name,
    String description,
    boolean isSystemRole,
    int userAssigned,
    List<String> permissionCodes,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
