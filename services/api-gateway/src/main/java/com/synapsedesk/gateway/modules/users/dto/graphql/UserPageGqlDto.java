package com.synapsedesk.gateway.modules.users.dto.graphql;

import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import java.util.List;

/** `UserPage` — `Query.users`'s return type. */
public record UserPageGqlDto(List<UserGqlDto> items, PageMetaGqlDto meta) {}
