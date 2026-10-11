package com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql;

import java.time.OffsetDateTime;

/** `IngestionJob` — the pipeline dashboard's own type, `document` resolved separately. */
public record IngestionJobGqlDto(
  String id,
  String documentId,
  String bullmqJobId,
  IngestionJobStatusGql status,
  String errorLog,
  OffsetDateTime processedAt,
  OffsetDateTime createdAt
) {}
