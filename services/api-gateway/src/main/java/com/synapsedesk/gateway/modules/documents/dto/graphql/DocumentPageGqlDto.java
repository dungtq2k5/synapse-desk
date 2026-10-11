package com.synapsedesk.gateway.modules.documents.dto.graphql;

import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import java.util.List;

/** `DocumentPage` — `Query.documents`'s return type. */
public record DocumentPageGqlDto(
  List<DocumentGqlDto> items,
  PageMetaGqlDto meta
) {}
