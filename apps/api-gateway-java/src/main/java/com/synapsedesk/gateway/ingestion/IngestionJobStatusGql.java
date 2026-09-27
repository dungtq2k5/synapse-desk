package com.synapsedesk.gateway.ingestion;

/** `IngestionJobStatus` — constant names matched by Spring for GraphQL to the schema enum by name. */
public enum IngestionJobStatusGql {
  CANCELLED,
  CHUNKING,
  COMPLETED,
  EMBEDDING,
  FAILED,
  PARSING,
  QUEUED
}
