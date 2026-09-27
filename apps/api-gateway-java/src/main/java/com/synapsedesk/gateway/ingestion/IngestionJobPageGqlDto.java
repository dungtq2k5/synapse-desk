package com.synapsedesk.gateway.ingestion;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.util.List;

/** `IngestionJobPage` — `Query.ingestionJobs`'s return type. */
public record IngestionJobPageGqlDto(List<IngestionJobGqlDto> items, PageMetaGqlDto meta) {}
