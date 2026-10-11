package com.synapsedesk.gateway.modules.roles.dto.graphql;

import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import java.util.List;

/** `RolePage` — `Query.roles`'s return type. */
public record RolePageGqlDto(List<RoleGqlDto> items, PageMetaGqlDto meta) {}
