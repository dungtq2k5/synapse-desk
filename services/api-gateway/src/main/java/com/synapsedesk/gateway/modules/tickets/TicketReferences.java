package com.synapsedesk.gateway.modules.tickets;

import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.DepartmentReferenceResponseDto;
import com.synapsedesk.gateway.common.dto.UserReferenceResponseDto;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.modules.tickets.dto.rest.MessageResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketResponseDto;
import io.grpc.stub.MetadataUtils;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import synapsedesk.auth.Department.ListDepartmentsByIdsRequest;
import synapsedesk.auth.DepartmentServiceGrpc;
import synapsedesk.auth.User.ListUsersByIdsRequest;
import synapsedesk.auth.User.UserProjection;
import synapsedesk.auth.User.UserSummary;
import synapsedesk.auth.UserServiceGrpc;

/**
 * Fills the names a ticket or message response shows: a ticket's {@code author},
 * {@code assignee} and {@code department}, a message's {@code sender}. Every route
 * that returns these classes calls it, so the fields are filled on all of them.
 *
 * <p><b>One lookup of each kind per response.</b> The distinct user ids on the page
 * go to auth-service in one {@code ListUsersByIds} call (summary projection,
 * inactive users included, scoped to the caller's organization), and the department
 * ids in one {@code ListDepartmentsByIds} call, scoped by the caller metadata.
 *
 * <p><b>Degrade, never fail.</b> A lookup that fails leaves its fields {@code null}
 * and the response still succeeds; so does an id that resolves to nothing, such as a
 * deleted user. An AI message's {@code sender} is {@code null}: no user wrote it.
 *
 * @example {@code references.fillTickets(context, List.of(dto))}
 */
@Component
public class TicketReferences {

  private static final Logger LOG = LoggerFactory.getLogger(
    TicketReferences.class
  );
  private static final long DEADLINE_SECONDS = 5;

  private final UserServiceGrpc.UserServiceBlockingStub users;
  private final DepartmentServiceGrpc.DepartmentServiceBlockingStub departments;

  public TicketReferences(
    UserServiceGrpc.UserServiceBlockingStub users,
    DepartmentServiceGrpc.DepartmentServiceBlockingStub departments
  ) {
    this.users = users;
    this.departments = departments;
  }

  /** Fills {@code author}, {@code assignee} and {@code department} on every ticket. */
  public void fillTickets(
    RequestContext context,
    Collection<TicketResponseDto> tickets
  ) {
    Set<String> userIds = new LinkedHashSet<>();
    Set<String> departmentIds = new LinkedHashSet<>();
    for (TicketResponseDto ticket : tickets) {
      addIfPresent(userIds, ticket.getAuthorId());
      addIfPresent(userIds, ticket.getCurrentAssigneeId());
      addIfPresent(departmentIds, ticket.getCurrentDepartmentId());
    }

    Map<String, UserReferenceResponseDto> people = users(context, userIds);
    Map<String, DepartmentReferenceResponseDto> teams = departments(
      context,
      departmentIds
    );
    for (TicketResponseDto ticket : tickets) {
      ticket.setAuthor(lookup(people, ticket.getAuthorId()));
      ticket.setAssignee(lookup(people, ticket.getCurrentAssigneeId()));
      ticket.setDepartment(lookup(teams, ticket.getCurrentDepartmentId()));
    }
  }

  /** Fills {@code sender} on every message; {@code null} for an AI message. */
  public void fillMessages(
    RequestContext context,
    Collection<MessageResponseDto> messages
  ) {
    Set<String> userIds = new LinkedHashSet<>();
    for (MessageResponseDto message : messages) {
      if (!isAi(message)) addIfPresent(userIds, message.getSenderId());
    }

    Map<String, UserReferenceResponseDto> people = users(context, userIds);
    for (MessageResponseDto message : messages) {
      message.setSender(
        isAi(message) ? null : lookup(people, message.getSenderId())
      );
    }
  }

  private Map<String, UserReferenceResponseDto> users(
    RequestContext context,
    Set<String> ids
  ) {
    if (ids.isEmpty()) return Map.of();
    try {
      List<UserSummary> summaries = users
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
          MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
        )
        .listUsersByIds(
          ListUsersByIdsRequest.newBuilder()
            .setOrganizationId(context.organizationIdOrEmpty())
            .addAllUserIds(ids)
            .setIncludeInactive(true)
            .setProjection(UserProjection.USER_PROJECTION_SUMMARY)
            .build()
        )
        .getSummariesList();

      Map<String, UserReferenceResponseDto> byId = new HashMap<>();
      for (UserSummary summary : summaries) {
        byId.put(
          summary.getUserId(),
          new UserReferenceResponseDto(
            summary.getUserId(),
            summary.getFullName(),
            summary.hasAvatarUrl() ? summary.getAvatarUrl() : null
          )
        );
      }
      return byId;
    } catch (RuntimeException failure) {
      LOG.warn("User names unavailable; answering without them", failure);
      return Map.of();
    }
  }

  private Map<String, DepartmentReferenceResponseDto> departments(
    RequestContext context,
    Set<String> ids
  ) {
    if (ids.isEmpty()) return Map.of();
    try {
      var items = departments
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
          MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
        )
        .listDepartmentsByIds(
          ListDepartmentsByIdsRequest.newBuilder()
            .addAllDepartmentIds(ids)
            .build()
        )
        .getItemsList();

      Map<String, DepartmentReferenceResponseDto> byId = new HashMap<>();
      for (var department : items) {
        byId.put(
          department.getId(),
          new DepartmentReferenceResponseDto(
            department.getId(),
            department.getName()
          )
        );
      }
      return byId;
    } catch (RuntimeException failure) {
      LOG.warn("Department names unavailable; answering without them", failure);
      return Map.of();
    }
  }

  private static boolean isAi(MessageResponseDto message) {
    return Boolean.TRUE.equals(message.getIsAiGenerated());
  }

  private static void addIfPresent(Set<String> ids, String id) {
    if (id != null && !id.isEmpty()) ids.add(id);
  }

  private static <T> T lookup(Map<String, T> byId, String id) {
    return id == null ? null : byId.get(id);
  }
}
