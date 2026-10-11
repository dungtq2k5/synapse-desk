package com.synapsedesk.gateway.modules.roles.dto.graphql;

/** `Permission` — one row of the tenant-wide catalogue, including retired codes. */
public record PermissionGqlDto(
  String id,
  String code,
  String name,
  String group,
  boolean isRetired
) {}
