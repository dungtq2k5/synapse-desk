package com.synapsedesk.gateway.documents;

/** `DocumentStatus` — constant names matched by Spring for GraphQL to the schema enum by name. */
public enum DocumentStatusGql {
  PENDING,
  PROCESSING,
  INDEXED,
  FAILED
}
