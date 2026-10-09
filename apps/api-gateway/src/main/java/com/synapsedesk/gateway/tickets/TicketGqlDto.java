package com.synapsedesk.gateway.tickets;

import java.time.OffsetDateTime;

/**
 * `Ticket` — flat. Unlike
 * {@code DocumentGqlDto}'s `createdById`, every raw id here
 * (`currentAssigneeId`, `currentDepartmentId`, `authorId`) is ALSO a schema
 * field in its own right, kept beside the loader-backed edge it seeds so a
 * client that only wants the id pays no network call for it.
 */
public record TicketGqlDto(
  String id,
  int ticketNumber,
  String organizationId,
  String authorId,
  TicketSourceGql source,
  TicketStatusGql status,
  TicketPriorityGql priority,
  String title,
  String description,
  String currentAssigneeId,
  String currentDepartmentId,
  OffsetDateTime escalatedAt,
  OffsetDateTime resolvedAt,
  int unreadCount,
  OffsetDateTime createdAt,
  OffsetDateTime updatedAt,
  OffsetDateTime deletedAt,
  String deletedById
) {}
