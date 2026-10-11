package com.synapsedesk.gateway.modules.tickets.dto.graphql;

/** `TicketMutationPayload` — every ticket mutation's return type. */
public record TicketMutationPayloadGqlDto(
  TicketGqlDto ticket,
  String message
) {}
