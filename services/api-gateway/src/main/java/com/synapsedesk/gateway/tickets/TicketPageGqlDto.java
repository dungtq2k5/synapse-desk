package com.synapsedesk.gateway.tickets;

import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import java.util.List;

/** `TicketPage` — `Query.tickets`'s return type. */
public record TicketPageGqlDto(List<TicketGqlDto> items, PageMetaGqlDto meta) {}
