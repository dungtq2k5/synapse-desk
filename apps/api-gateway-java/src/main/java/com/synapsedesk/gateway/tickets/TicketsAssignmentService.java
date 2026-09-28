package com.synapsedesk.gateway.tickets;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.AssignTicketDto;
import com.synapsedesk.gateway.generated.model.AssignTicketToSelfDto;
import com.synapsedesk.gateway.generated.model.AssignmentResponseDto;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.MarkTicketReadDto;
import com.synapsedesk.gateway.generated.model.MarkTicketReadResponseDto;
import com.synapsedesk.gateway.generated.model.TicketStatusChangeResponseDto;
import com.synapsedesk.gateway.generated.model.TicketsControllerAssignV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListAssignmentsV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListStatusChangesV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerMarkReadV1200Response;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import synapsedesk.ticket.Assignment.AssignTicketRequest;
import synapsedesk.ticket.Assignment.AssignTicketToSelfRequest;
import synapsedesk.ticket.Assignment.AssignmentResponse;
import synapsedesk.ticket.Assignment.ListAssignmentsRequest;
import synapsedesk.ticket.Assignment.ListAssignmentsResponse;
import synapsedesk.ticket.Assignment.UnassignTicketRequest;
import synapsedesk.ticket.AssignmentServiceGrpc;
import synapsedesk.ticket.Common.ReassignmentReason;
import synapsedesk.ticket.Ticket.MarkTicketReadRequest;
import synapsedesk.ticket.Ticket.MarkTicketReadResponse;
import synapsedesk.ticket.Ticket.TicketIdRequest;
import synapsedesk.ticket.Ticket.TicketStatusChangeResponse;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketsApi`'s assignment-and-read-state group (7 of the 10 ops in group
 * c: {@code assign}, {@code reassign}, {@code assignToSelf}, {@code
 * unassign}, {@code listAssignments}, {@code markRead}, {@code
 * listStatusChanges}). See {@link TicketsCrudService} for why this is a
 * plain service, not yet a routed controller.
 *
 * <p><b>The sibling-code risk this whole 3-group split exists for.</b>
 * {@code assign}/{@code reassign}/{@code assignToSelf}/{@code unassign} are
 * FOUR independent string-literal permission checks in Node — no shared
 * constant forces them apart — so a copy-paste in the port could silently
 * swap {@code ticket.assign} and {@code ticket.assign.self} between {@code
 * assign} and {@code assignToSelf} without any structural check catching
 * it. Settled explicitly, per the question raised before writing this
 * file: {@code assignToSelf} needs NO handler-body check to stop it from
 * assigning to someone else — unlike {@code includeDeleted}, which genuinely
 * needs one because ONE route serves two audiences. Here the separation is
 * structural on BOTH sides: {@link AssignTicketToSelfDto} carries no {@code
 * assigneeId} field at all (only {@code departmentId} — the assignee is
 * implicitly the caller), and {@code assign}'s own permission check accepts
 * only {@code ticket.assign}, never OR'd with {@code ticket.assign.self}, so
 * a caller holding only the weaker grant is refused before reaching a route
 * where the DTO shape would even let them target someone else. Two
 * independent barriers, not one relying on the other.
 *
 * <p><b>{@code assign} and {@code reassign} share one wire request and one
 * peer RPC-pair</b> ({@code AssignTicketRequest} → {@code AssignTicket}/
 * {@code ReassignTicket}) — which one a call IS is resolved server-side
 * from the ticket's current state, never by which literal the gateway
 * calls. The two routes differ ONLY in which permission code gates them.
 */
@Component
public class TicketsAssignmentService {

  private static final long DEADLINE_SECONDS = 5;

  private final AssignmentServiceGrpc.AssignmentServiceBlockingStub assignmentStub;
  private final TicketServiceGrpc.TicketServiceBlockingStub ticketStub;

  public TicketsAssignmentService(
    AssignmentServiceGrpc.AssignmentServiceBlockingStub assignmentStub,
    TicketServiceGrpc.TicketServiceBlockingStub ticketStub
  ) {
    this.assignmentStub = assignmentStub;
    this.ticketStub = ticketStub;
  }

  public ResponseEntity<TicketsControllerAssignV1200Response> assign(
    RequestContext context,
    String id,
    AssignTicketDto dto
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_ASSIGN
    );

    AssignmentResponse response = withAssignmentMetadata(context).assignTicket(
      toAssignTicketRequest(id, dto)
    );

    return ok(response, "Ticket assigned");
  }

  public ResponseEntity<TicketsControllerAssignV1200Response> reassign(
    RequestContext context,
    String id,
    AssignTicketDto dto
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_REASSIGN
    );

    AssignmentResponse response = withAssignmentMetadata(
      context
    ).reassignTicket(toAssignTicketRequest(id, dto));

    return ok(response, "Ticket reassigned");
  }

  public ResponseEntity<TicketsControllerAssignV1200Response> assignToSelf(
    RequestContext context,
    String id,
    AssignTicketToSelfDto dto
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_ASSIGN_SELF
    );

    AssignmentResponse response = withAssignmentMetadata(
      context
    ).assignTicketToSelf(
      AssignTicketToSelfRequest.newBuilder()
        .setTicketId(id)
        .setDepartmentId(dto.getDepartmentId().toString())
        .build()
    );

    return ok(response, "Ticket claimed");
  }

  public ResponseEntity<AuthControllerForgotPasswordV1202Response> unassign(
    RequestContext context,
    String id
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_ASSIGN
    );

    withAssignmentMetadata(context).unassignTicket(
      UnassignTicketRequest.newBuilder().setTicketId(id).build()
    );

    return ResponseEntity.status(HttpStatus.NO_CONTENT).body(
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(204))
        .message("OK")
    );
  }

  /** No permission beyond reading the ticket — the service applies the same author-or-assignee filter it applies to the ticket itself. */
  public ResponseEntity<TicketsControllerListAssignmentsV1200Response> listAssignments(
    RequestContext context,
    String id
  ) {
    ListAssignmentsResponse response = withAssignmentMetadata(
      context
    ).listAssignments(
      ListAssignmentsRequest.newBuilder().setTicketId(id).build()
    );

    return ResponseEntity.ok(
      new TicketsControllerListAssignmentsV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(
          response
            .getItemsList()
            .stream()
            .map(TicketsAssignmentService::toAssignmentResponseDto)
            .toList()
        )
    );
  }

  /**
   * No permission beyond reading the ticket — a fact about what THIS caller
   * has seen. {@code readAt} is forwarded exactly as sent, never
   * server-stamped here: an absent value lets ticket-service use its own
   * clock, which marks read every message that arrived between the
   * client's render and this request — the Java port must not "helpfully"
   * default it either.
   */
  public ResponseEntity<TicketsControllerMarkReadV1200Response> markRead(
    RequestContext context,
    String id,
    MarkTicketReadDto dto
  ) {
    MarkTicketReadRequest.Builder wire =
      MarkTicketReadRequest.newBuilder().setTicketId(id);
    if (dto.getReadAt() != null) {
      wire.setReadAt(TicketsCrudService.toTimestamp(dto.getReadAt()));
    }

    MarkTicketReadResponse response = withTicketMetadata(
      context
    ).markTicketRead(wire.build());

    return ResponseEntity.ok(
      new TicketsControllerMarkReadV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("Marked read")
        .data(
          new MarkTicketReadResponseDto().lastReadAt(
            TicketsCrudService.toOffsetDateTime(response.getLastReadAt())
          )
        )
    );
  }

  /** Not `audit_logs` — ticket data behind the same visibility filter as the ticket itself, not an admin-gated table. */
  public ResponseEntity<TicketsControllerListStatusChangesV1200Response> listStatusChanges(
    RequestContext context,
    String id
  ) {
    var response = withTicketMetadata(context).listTicketStatusChanges(
      TicketIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.ok(
      new TicketsControllerListStatusChangesV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(
          response
            .getItemsList()
            .stream()
            .map(TicketsAssignmentService::toStatusChangeDto)
            .toList()
        )
    );
  }

  private static AssignTicketRequest toAssignTicketRequest(
    String id,
    AssignTicketDto dto
  ) {
    AssignTicketRequest.Builder wire = AssignTicketRequest.newBuilder()
      .setTicketId(id)
      .setAssigneeId(dto.getAssigneeId().toString())
      .setDepartmentId(dto.getDepartmentId().toString());
    if (dto.getReason() != null) {
      wire.setReason(
        ReassignmentReason.valueOf(
          "REASSIGNMENT_REASON_" + dto.getReason().getValue()
        )
      );
    }
    return wire.build();
  }

  private static ResponseEntity<TicketsControllerAssignV1200Response> ok(
    AssignmentResponse response,
    String message
  ) {
    return ResponseEntity.ok(
      new TicketsControllerAssignV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message(message)
        .data(toAssignmentResponseDto(response))
    );
  }

  private static AssignmentResponseDto toAssignmentResponseDto(
    AssignmentResponse assignment
  ) {
    return new AssignmentResponseDto()
      .id(assignment.getId())
      .ticketId(assignment.getTicketId())
      .assignedToId(assignment.getAssignedToId())
      .assignedById(assignment.getAssignedById())
      .departmentId(assignment.getDepartmentId())
      .assignedAt(
        TicketsCrudService.toOffsetDateTime(assignment.getAssignedAt())
      )
      .unassignedAt(
        assignment.hasUnassignedAt()
          ? TicketsCrudService.toOffsetDateTime(assignment.getUnassignedAt())
          : null
      )
      .reason(
        assignment.getReason() ==
          ReassignmentReason.REASSIGNMENT_REASON_UNSPECIFIED
          ? null
          : AssignmentResponseDto.ReasonEnum.fromValue(
              assignment.getReason().name().replace("REASSIGNMENT_REASON_", "")
            )
      )
      .isCurrent(assignment.getIsCurrent())
      .createdAt(
        TicketsCrudService.toOffsetDateTime(assignment.getCreatedAt())
      );
  }

  private static TicketStatusChangeResponseDto toStatusChangeDto(
    TicketStatusChangeResponse row
  ) {
    return new TicketStatusChangeResponseDto()
      .id(row.getId())
      .ticketId(row.getTicketId())
      .fromStatus(
        row.hasFromStatus()
          ? TicketStatusChangeResponseDto.FromStatusEnum.fromValue(
              row.getFromStatus().name().replace("TICKET_STATUS_", "")
            )
          : null
      )
      .toStatus(
        TicketStatusChangeResponseDto.ToStatusEnum.fromValue(
          row.getToStatus().name().replace("TICKET_STATUS_", "")
        )
      )
      .changedById(row.getChangedById())
      .reason(row.hasReason() ? row.getReason() : null)
      .changedAt(TicketsCrudService.toOffsetDateTime(row.getChangedAt()));
  }

  private AssignmentServiceGrpc.AssignmentServiceBlockingStub withAssignmentMetadata(
    RequestContext context
  ) {
    return assignmentStub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }

  private TicketServiceGrpc.TicketServiceBlockingStub withTicketMetadata(
    RequestContext context
  ) {
    return ticketStub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
