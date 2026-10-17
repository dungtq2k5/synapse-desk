package com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql;

/** `IngestionErrorCode` — constant names matched by Spring for GraphQL to the schema enum by name. */
public enum IngestionErrorCodeGql {
  NO_READABLE_TEXT,
  OCR_UNAVAILABLE,
  OTHER,
  PROVIDER_FAILURE,
  TOO_LONG,
}
