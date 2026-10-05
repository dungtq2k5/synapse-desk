package com.synapsedesk.gateway.tickets;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.graphql.PageMetaGqlDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.ticket.Ai.DraftCitation;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Message.MessageAnswerStatus;
import synapsedesk.ticket.Message.MessageResponse;
import synapsedesk.ticket.Ticket.ListTicketsResponse;

/** Wire `TicketResponse`/`MessageResponse` -> the GraphQL DTOs — `ticket.mapper.ts`, reproduced. */
public final class TicketMapper {

  private TicketMapper() {}

  public static TicketGqlDto toTicketGqlDto(TicketResponse ticket) {
    return new TicketGqlDto(
      ticket.getId(),
      Math.toIntExact(ticket.getTicketNumber()),
      ticket.getOrganizationId(),
      ticket.getAuthorId(),
      toSourceGql(ticket.getSource()),
      toStatusGql(ticket.getStatus()),
      toPriorityGql(ticket.getPriority()),
      ticket.getTitle(),
      ticket.getDescription(),
      ticket.hasCurrentAssigneeId() ? ticket.getCurrentAssigneeId() : null,
      ticket.hasCurrentDepartmentId() ? ticket.getCurrentDepartmentId() : null,
      ticket.hasEscalatedAt()
        ? toOffsetDateTime(ticket.getEscalatedAt())
        : null,
      ticket.hasResolvedAt() ? toOffsetDateTime(ticket.getResolvedAt()) : null,
      ticket.getUnreadCount(),
      toOffsetDateTime(ticket.getCreatedAt()),
      toOffsetDateTime(ticket.getUpdatedAt()),
      ticket.hasDeletedAt() ? toOffsetDateTime(ticket.getDeletedAt()) : null,
      ticket.hasDeletedById() ? ticket.getDeletedById() : null
    );
  }

  public static TicketPageGqlDto toTicketPageGqlDto(
    ListTicketsResponse response
  ) {
    return new TicketPageGqlDto(
      response
        .getItemsList()
        .stream()
        .map(TicketMapper::toTicketGqlDto)
        .toList(),
      toPageMetaGqlDto(response.getMeta())
    );
  }

  public static TicketMessageGqlDto toTicketMessageGqlDto(
    MessageResponse message
  ) {
    return new TicketMessageGqlDto(
      message.getId(),
      message.getTicketId(),
      message.hasSenderId() ? message.getSenderId() : null,
      message.getContent(),
      message.getIsAiGenerated(),
      message.getIsInternalNote(),
      message.hasModelName() ? message.getModelName() : null,
      message.hasPromptTokens() ? message.getPromptTokens() : null,
      message.hasCompletionTokens() ? message.getCompletionTokens() : null,
      message.hasEditedAt() ? toOffsetDateTime(message.getEditedAt()) : null,
      message.hasRedactedAt()
        ? toOffsetDateTime(message.getRedactedAt())
        : null,
      toOffsetDateTime(message.getCreatedAt()),
      toAnswerStatus(message.getAnswerStatus()),
      message.hasCitations()
        ? message
            .getCitations()
            .getItemsList()
            .stream()
            .map(TicketMapper::toCitationGqlDto)
            .toList()
        : null
    );
  }

  private static CitationGqlDto toCitationGqlDto(DraftCitation citation) {
    return new CitationGqlDto(
      citation.getChunkId(),
      citation.getDocumentId(),
      citation.getDocumentTitle(),
      citation.hasPageNumber() ? citation.getPageNumber() : null
    );
  }

  /** `UNSPECIFIED` -> `null`, matching Node's "a value this build cannot name answers null". */
  private static TicketSourceGql toSourceGql(TicketSource source) {
    return switch (source) {
      case TICKET_SOURCE_WEB -> TicketSourceGql.WEB;
      case TICKET_SOURCE_CHAT -> TicketSourceGql.CHAT;
      case TICKET_SOURCE_EMAIL -> TicketSourceGql.EMAIL;
      case TICKET_SOURCE_API -> TicketSourceGql.API;
      default -> null;
    };
  }

  private static TicketStatusGql toStatusGql(TicketStatus status) {
    return switch (status) {
      case TICKET_STATUS_NEW -> TicketStatusGql.NEW;
      case TICKET_STATUS_OPEN -> TicketStatusGql.OPEN;
      case TICKET_STATUS_PENDING_AGENT -> TicketStatusGql.PENDING_AGENT;
      case TICKET_STATUS_ESCALATED -> TicketStatusGql.ESCALATED;
      case TICKET_STATUS_RESOLVED -> TicketStatusGql.RESOLVED;
      case TICKET_STATUS_CLOSED -> TicketStatusGql.CLOSED;
      default -> null;
    };
  }

  private static TicketPriorityGql toPriorityGql(TicketPriority priority) {
    return switch (priority) {
      case TICKET_PRIORITY_LOW -> TicketPriorityGql.LOW;
      case TICKET_PRIORITY_MEDIUM -> TicketPriorityGql.MEDIUM;
      case TICKET_PRIORITY_HIGH -> TicketPriorityGql.HIGH;
      case TICKET_PRIORITY_URGENT -> TicketPriorityGql.URGENT;
      default -> null;
    };
  }

  /** `MESSAGE_ANSWER_STATUS_DOC_ANSWER` -> `"DOC_ANSWER"`; `UNSPECIFIED` -> `null`. */
  private static String toAnswerStatus(MessageAnswerStatus status) {
    return status == MessageAnswerStatus.MESSAGE_ANSWER_STATUS_UNSPECIFIED
      ? null
      : status.name().replace("MESSAGE_ANSWER_STATUS_", "");
  }

  private static PageMetaGqlDto toPageMetaGqlDto(PageMeta meta) {
    return new PageMetaGqlDto(
      meta.getTotalItems(),
      meta.getItemCount(),
      meta.getItemsPerPage(),
      meta.getTotalPages(),
      meta.getCurrentPage()
    );
  }

  private static OffsetDateTime toOffsetDateTime(Timestamp timestamp) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}
