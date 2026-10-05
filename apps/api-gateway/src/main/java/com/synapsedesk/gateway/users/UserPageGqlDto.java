package com.synapsedesk.gateway.users;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.util.List;

/** `UserPage` — `Query.users`'s return type. */
public record UserPageGqlDto(List<UserGqlDto> items, PageMetaGqlDto meta) {}
