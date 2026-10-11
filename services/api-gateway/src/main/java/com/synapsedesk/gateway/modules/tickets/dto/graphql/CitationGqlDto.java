package com.synapsedesk.gateway.modules.tickets.dto.graphql;

/** `Citation` — one passage an AI answer cited. */
public record CitationGqlDto(
  String chunkId,
  String documentId,
  String documentTitle,
  Integer pageNumber
) {}
