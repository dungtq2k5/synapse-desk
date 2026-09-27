package com.synapsedesk.gateway.roles;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Role.ListRolesResponse;
import synapsedesk.auth.Role.PermissionResponse;
import synapsedesk.auth.Role.RoleResponse;

/** Wire `RoleResponse`/`PermissionResponse` -> the GraphQL DTOs — `role.mapper.ts`, reproduced. */
public final class RoleMapper {

  private RoleMapper() {}

  public static RoleGqlDto toRoleGqlDto(RoleResponse role) {
    return new RoleGqlDto(
        role.getId(),
        role.getName(),
        role.hasDescription() ? role.getDescription() : null,
        role.getIsSystemRole(),
        role.getUserAssigned(),
        role.getPermissionCodesList(),
        toOffsetDateTime(role.getCreatedAt()),
        toOffsetDateTime(role.getUpdatedAt()));
  }

  public static PermissionGqlDto toPermissionGqlDto(PermissionResponse permission) {
    return new PermissionGqlDto(
        permission.getId(),
        permission.getCode(),
        permission.getName(),
        permission.getGroup(),
        permission.getIsRetired());
  }

  public static RolePageGqlDto toRolePageGqlDto(ListRolesResponse response) {
    return new RolePageGqlDto(
        response.getItemsList().stream().map(RoleMapper::toRoleGqlDto).toList(),
        toPageMetaGqlDto(response.getMeta()));
  }

  private static PageMetaGqlDto toPageMetaGqlDto(PageMeta meta) {
    return new PageMetaGqlDto(
        meta.getTotalItems(),
        meta.getItemCount(),
        meta.getItemsPerPage(),
        meta.getTotalPages(),
        meta.getCurrentPage());
  }

  private static OffsetDateTime toOffsetDateTime(com.google.protobuf.Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos()).atOffset(ZoneOffset.UTC);
  }
}
