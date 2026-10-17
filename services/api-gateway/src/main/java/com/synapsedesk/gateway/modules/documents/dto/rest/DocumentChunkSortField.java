package com.synapsedesk.gateway.modules.documents.dto.rest;

/**
 * The {@code sortBy} values a document's chunk list accepts: {@code chunkIndex}
 * only, the order the passages read in. A value outside it is refused with a
 * 400 before any handler or peer runs, and the document publishes the enum
 * from the type.
 *
 * <p>The constant is spelled as the wire value because Spring converts the
 * parameter by constant name.
 */
public enum DocumentChunkSortField {
  chunkIndex,
}
