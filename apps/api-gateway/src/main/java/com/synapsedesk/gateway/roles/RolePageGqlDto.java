package com.synapsedesk.gateway.roles;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.util.List;

/** `RolePage` — `Query.roles`'s return type. */
public record RolePageGqlDto(List<RoleGqlDto> items, PageMetaGqlDto meta) {}
