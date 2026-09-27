package com.synapsedesk.gateway.users;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * `User` — the FULL profile, flat, matching `user-response.gql-dto.ts`'s own
 * `{...user, departmentIds}` shape: `departmentIds` is a SIBLING of the user
 * on every envelope this is built from (`CurrentUserResponse`,
 * `UserSummaryResponse`), never a field of the user itself. `departmentCount`
 * and `departments` are resolved off {@link #departmentIds} by {@link
 * UsersResolver}, not carried here.
 */
public record UserGqlDto(
    String id,
    String organizationId,
    List<String> departmentIds,
    String fullName,
    String avatarUrl,
    String email,
    boolean isEmailVerified,
    String phoneNumber,
    boolean isPhoneVerified,
    String dob,
    GenderGql gender,
    OffsetDateTime lastLoginAt,
    boolean isLocked,
    OffsetDateTime lockedUntil,
    boolean isTwoFactorEnabled,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
