package com.synapsedesk.gateway.modules.tickets.dto.graphql;

/** `TicketStatus` — constant names matched by Spring for GraphQL to the schema enum by name. */
public enum TicketStatusGql {
  NEW,
  OPEN,
  PENDING_AGENT,
  ESCALATED,
  RESOLVED,
  CLOSED,
}
