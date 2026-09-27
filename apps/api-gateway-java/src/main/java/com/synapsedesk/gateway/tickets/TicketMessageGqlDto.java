package com.synapsedesk.gateway.tickets;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * `TicketMessage` — one row of a ticket thread, flat, matching
 * `message-response.gql-dto.ts`. No `attachments`: the schema does not carry
 * them, since the URLs are internal object paths resolved per REST request.
 */
public record TicketMessageGqlDto(
    String id,
    String ticketId,
    String senderId,
    String content,
    boolean isAiGenerated,
    boolean isInternalNote,
    String modelName,
    Integer promptTokens,
    Integer completionTokens,
    OffsetDateTime editedAt,
    OffsetDateTime redactedAt,
    OffsetDateTime createdAt,
    String answerStatus,
    List<CitationGqlDto> citations) {}
