package com.synapsedesk.gateway.modules.documents.dto.graphql;

/** `DocumentStatus` — constant names matched by Spring for GraphQL to the schema enum by name. */
public enum DocumentStatusGql {
  PENDING,
  PROCESSING,
  INDEXED,
  FAILED,
}
