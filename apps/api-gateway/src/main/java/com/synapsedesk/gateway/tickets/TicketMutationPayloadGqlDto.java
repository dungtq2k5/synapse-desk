package com.synapsedesk.gateway.tickets;

/** `TicketMutationPayload` — every ticket mutation's return type. */
public record TicketMutationPayloadGqlDto(
  TicketGqlDto ticket,
  String message
) {}
