package com.synapsedesk.gateway.documents;

import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.util.List;

/** `DocumentPage` — `Query.documents`'s return type. */
public record DocumentPageGqlDto(
  List<DocumentGqlDto> items,
  PageMetaGqlDto meta
) {}
