package com.synapsedesk.gateway.tickets;

/** `Citation` — one passage an AI answer cited. */
public record CitationGqlDto(
  String chunkId,
  String documentId,
  String documentTitle,
  Integer pageNumber
) {}
