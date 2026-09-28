package com.synapsedesk.gateway.graphql;

import java.time.OffsetDateTime;

/**
 * `UserSummary` — name and avatar only, reachable from whatever permission
 * the edge itself required; `User` and its contact details sit behind
 * `Query.user`/`user.read`. Loader-backed everywhere it appears
 * (`Ticket.assignee`, `TicketMessage.sender`, …), never fetched directly.
 */
public record UserSummaryGqlDto(
  String id,
  String fullName,
  String avatarUrl,
  boolean isLocked,
  OffsetDateTime deletedAt
) {}
