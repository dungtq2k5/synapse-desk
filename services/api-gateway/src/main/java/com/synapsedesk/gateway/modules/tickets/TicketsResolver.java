package com.synapsedesk.gateway.modules.tickets;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.common.graphql.GraphqlLimits;
import com.synapsedesk.gateway.common.graphql.UserSummaryGqlDto;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.modules.departments.dto.graphql.DepartmentGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketMessageGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketMutationPayloadGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketPageGqlDto;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketPriorityGql;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketSourceGql;
import com.synapsedesk.gateway.modules.tickets.dto.graphql.TicketStatusGql;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.dataloader.DataLoader;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.graphql.data.method.annotation.SchemaMapping;
import org.springframework.stereotype.Controller;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ticket.Assignment.AssignTicketRequest;
import synapsedesk.ticket.AssignmentServiceGrpc;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Message.ListMessagesRequest;
import synapsedesk.ticket.Message.ListMessagesResponse;
import synapsedesk.ticket.MessageServiceGrpc;
import synapsedesk.ticket.Ticket.ChangeTicketStatusRequest;
import synapsedesk.ticket.Ticket.GetTicketRequest;
import synapsedesk.ticket.Ticket.ListTicketsRequest;
import synapsedesk.ticket.Ticket.ListTicketsResponse;
import synapsedesk.ticket.Ticket.TicketStatusActionRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `Query.ticket`, `Query.tickets`, the `Ticket` edges, and its three
 * mutations.
 *
 * <p>A resolver is a transport, not an implementation: every method here
 * calls the same gRPC stubs the REST surface will, with a context built from
 * the request, and does nothing else.
 */
@Controller
public class TicketsResolver {

  private static final long DEADLINE_SECONDS = 5;

  private final TicketServiceGrpc.TicketServiceBlockingStub ticketStub;
  private final MessageServiceGrpc.MessageServiceBlockingStub messageStub;
  private final AssignmentServiceGrpc.AssignmentServiceBlockingStub assignmentStub;
  private final CurrentUser currentUser;

  public TicketsResolver(
    TicketServiceGrpc.TicketServiceBlockingStub ticketStub,
    MessageServiceGrpc.MessageServiceBlockingStub messageStub,
    AssignmentServiceGrpc.AssignmentServiceBlockingStub assignmentStub,
    CurrentUser currentUser
  ) {
    this.ticketStub = ticketStub;
    this.messageStub = messageStub;
    this.assignmentStub = assignmentStub;
    this.currentUser = currentUser;
  }

  @QueryMapping
  public TicketGqlDto ticket(@Argument String id) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    try {
      TicketResponse response = withMetadata(ticketStub, context).getTicket(
        GetTicketRequest.newBuilder().setId(id).build()
      );
      return TicketMapper.toTicketGqlDto(response);
    } catch (StatusRuntimeException notFoundOrForbidden) {
      // Not found, another tenant, or not visible to this caller —
      // deliberately indistinguishable, matching `Query.ticket`'s own schema
      // description.
      return null;
    }
  }

  @QueryMapping(name = "tickets")
  public TicketPageGqlDto tickets(
    @Argument int first,
    @Argument int page,
    @Argument String sortBy,
    @Argument TicketStatusGql status,
    @Argument TicketPriorityGql priority,
    @Argument TicketSourceGql source,
    @Argument String assigneeId,
    @Argument String departmentId,
    @Argument String authorId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page)
      // Clamped, not rejected: an unbounded list multiplies every nested
      // field beneath it, but refusing `first: 500` would break a client
      // that sends it today.
      .setLimit(Math.min(first, GraphqlLimits.MAX_PAGE_SIZE))
      .setSortBy(sortBy != null ? sortBy : "createdAt")
      .setSortOrder(SortOrder.SORT_ORDER_DESC);

    ListTicketsRequest.Builder wire = ListTicketsRequest.newBuilder()
      .setPage(pageRequest)
      .setIncludeDeleted(false);
    if (status != null) {
      wire.setStatus(TicketStatus.valueOf("TICKET_STATUS_" + status.name()));
    }
    if (priority != null) {
      wire.setPriority(
        TicketPriority.valueOf("TICKET_PRIORITY_" + priority.name())
      );
    }
    if (source != null) {
      wire.setSource(TicketSource.valueOf("TICKET_SOURCE_" + source.name()));
    }
    if (assigneeId != null) {
      wire.setAssigneeId(assigneeId);
    }
    if (departmentId != null) {
      wire.setDepartmentId(departmentId);
    }
    if (authorId != null) {
      wire.setAuthorId(authorId);
    }

    ListTicketsResponse response = withMetadata(
      ticketStub,
      context
    ).listTickets(wire.build());

    return TicketMapper.toTicketPageGqlDto(response);
  }

  // ------------------------------------------------------------- edges

  /** `Ticket.assignee` — loader-backed, never a direct call; null for an unassigned ticket. */
  @SchemaMapping(typeName = "Ticket", field = "assignee")
  public CompletableFuture<UserSummaryGqlDto> assignee(
    TicketGqlDto ticket,
    DataLoader<String, UserSummaryGqlDto> loader
  ) {
    if (ticket.currentAssigneeId() == null) {
      return CompletableFuture.completedFuture(null);
    }

    RequestContext context = currentUser.require(CurrentRequest.request());
    return loader.load(ticket.currentAssigneeId(), context);
  }

  /** `Ticket.author` — the SAME loader instance as {@link #assignee}. */
  @SchemaMapping(typeName = "Ticket", field = "author")
  public CompletableFuture<UserSummaryGqlDto> author(
    TicketGqlDto ticket,
    DataLoader<String, UserSummaryGqlDto> loader
  ) {
    if (ticket.authorId() == null) {
      return CompletableFuture.completedFuture(null);
    }

    RequestContext context = currentUser.require(CurrentRequest.request());
    return loader.load(ticket.authorId(), context);
  }

  @SchemaMapping(typeName = "Ticket", field = "department")
  public CompletableFuture<DepartmentGqlDto> department(
    TicketGqlDto ticket,
    DataLoader<String, DepartmentGqlDto> loader
  ) {
    if (ticket.currentDepartmentId() == null) {
      return CompletableFuture.completedFuture(null);
    }

    RequestContext context = currentUser.require(CurrentRequest.request());
    return loader.load(ticket.currentDepartmentId(), context);
  }

  /**
   * `Ticket.messages` — the thread. No loader, deliberately: the messages
   * live in the same service as the ticket, fetched by ticket id, so there
   * is no `ListMessagesByIds` to batch into. One call per ticket, which is
   * why the cost scorer weights this field and `first` is clamped above it.
   */
  @SchemaMapping(typeName = "Ticket", field = "messages")
  public List<TicketMessageGqlDto> messages(
    TicketGqlDto ticket,
    @Argument int first
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ListMessagesResponse response = withMetadata(
      messageStub,
      context
    ).listMessages(
      ListMessagesRequest.newBuilder()
        .setTicketId(ticket.id())
        .setPage(
          PageRequest.newBuilder()
            .setPage(1)
            .setLimit(Math.min(first, GraphqlLimits.MAX_PAGE_SIZE))
            .setSortBy("createdAt")
            .setSortOrder(SortOrder.SORT_ORDER_ASC)
        )
        .build()
    );

    return response
      .getItemsList()
      .stream()
      .map(TicketMapper::toTicketMessageGqlDto)
      .toList();
  }

  // ---------------------------------------------------------- mutations

  @MutationMapping
  @RequirePermission(PermissionCodesEnum.TICKET_ASSIGN)
  public TicketMutationPayloadGqlDto assignTicket(
    @Argument String id,
    @Argument String assigneeId,
    @Argument String departmentId
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    withMetadata(assignmentStub, context).assignTicket(
      AssignTicketRequest.newBuilder()
        .setTicketId(id)
        .setAssigneeId(assigneeId)
        .setDepartmentId(departmentId)
        .build()
    );

    TicketResponse ticket = withMetadata(ticketStub, context).getTicket(
      GetTicketRequest.newBuilder().setId(id).build()
    );

    return new TicketMutationPayloadGqlDto(
      TicketMapper.toTicketGqlDto(ticket),
      "Ticket assigned"
    );
  }

  @MutationMapping
  public TicketMutationPayloadGqlDto escalateTicket(@Argument String id) {
    // No `@RequirePermission`, matching the REST route: escalating is what
    // an end user does when self-service has not helped, and requiring a
    // grant would make the handoff unreachable for exactly the person who
    // needs it.
    RequestContext context = currentUser.require(CurrentRequest.request());

    TicketResponse ticket = withMetadata(ticketStub, context).escalateTicket(
      TicketStatusActionRequest.newBuilder().setTicketId(id).build()
    );

    return new TicketMutationPayloadGqlDto(
      TicketMapper.toTicketGqlDto(ticket),
      "Handed off to an agent"
    );
  }

  @MutationMapping
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public TicketMutationPayloadGqlDto transitionTicketStatus(
    @Argument String id,
    @Argument TicketStatusGql status,
    @Argument String reason
  ) {
    RequestContext context = currentUser.require(CurrentRequest.request());

    ChangeTicketStatusRequest.Builder wire =
      ChangeTicketStatusRequest.newBuilder()
        .setId(id)
        .setStatus(TicketStatus.valueOf("TICKET_STATUS_" + status.name()));
    if (reason != null) {
      wire.setReason(reason);
    }

    TicketResponse ticket = withMetadata(
      ticketStub,
      context
    ).changeTicketStatus(wire.build());

    return new TicketMutationPayloadGqlDto(
      TicketMapper.toTicketGqlDto(ticket),
      "Status set to " + status
    );
  }

  private static <S extends io.grpc.stub.AbstractBlockingStub<S>> S withMetadata(
    S stub,
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
