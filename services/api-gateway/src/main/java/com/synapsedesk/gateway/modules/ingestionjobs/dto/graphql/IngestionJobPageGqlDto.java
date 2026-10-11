package com.synapsedesk.gateway.modules.ingestionjobs.dto.graphql;

import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import java.util.List;

/** `IngestionJobPage` — `Query.ingestionJobs`'s return type. */
public record IngestionJobPageGqlDto(
  List<IngestionJobGqlDto> items,
  PageMetaGqlDto meta
) {}
