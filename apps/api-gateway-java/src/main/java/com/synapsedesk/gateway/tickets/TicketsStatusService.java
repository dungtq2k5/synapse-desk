package com.synapsedesk.gateway.tickets;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import com.synapsedesk.gateway.model.BulkTicketFailureResponseDto;
import com.synapsedesk.gateway.model.BulkTicketPriorityDto;
import com.synapsedesk.gateway.model.BulkTicketPriorityResponseDto;
import com.synapsedesk.gateway.model.BulkTicketStatusDto;
import com.synapsedesk.gateway.model.BulkTicketStatusResponseDto;
import com.synapsedesk.gateway.model.ChangeTicketStatusDto;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.model.TicketResponseDto;
import com.synapsedesk.gateway.model.TicketStatusActionDto;
import com.synapsedesk.gateway.web.ApiResponse;
import io.grpc.stub.MetadataUtils;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Ticket.BulkTicketPriorityRequest;
import synapsedesk.ticket.Ticket.BulkTicketPriorityResponse;
import synapsedesk.ticket.Ticket.BulkTicketStatusRequest;
import synapsedesk.ticket.Ticket.BulkTicketStatusResponse;
import synapsedesk.ticket.Ticket.ChangeTicketStatusRequest;
import synapsedesk.ticket.Ticket.TicketStatusActionRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketsApi`'s status-state-machine-and-bulk group (7 of 24 operations)
 * — the second of three sub-passes (see {@link TicketsCrudService} for why
 * this is a plain service, not yet a routed controller).
 *
 * <p><b>{@code RESOLVED}/{@code CLOSED} are NOT refused here.</b> Node's own
 * comment on {@code changeStatus} is explicit: ticket-service refuses those
 * two targets (400, naming the route to use), specifically so this route's
 * {@code @RequirePermission('ticket.update')} decorator keeps describing
 * exactly what the route does — a gateway-side duplicate check would be a
 * SECOND, potentially diverging, encoding of the same rule the docblock on
 * {@code ChangeTicketStatusRequest} already calls out as a single-source
 * validator in {@code TICKET_STATUS_TRANSITIONS}. Forwarded faithfully; the
 * peer's refusal surfaces through the same gRPC-error-to-400 mapping every
 * other controller in this port already relies on.
 *
 * <p><b>Bulk ops are partial-success, always 200</b> — never a 207, never
 * a 4xx for a request where SOME ids failed. The operation itself
 * succeeded: it processed every id and is reporting what happened to each,
 * in the body's {@code failed[]}. {@code MAX_BULK_TICKET_IDS} (50) is
 * hand-enforced in {@link #requireWithinBulkLimit} — the generator dropped
 * the upper bound ({@code @Size(min = 1)} only, no {@code max}), same
 * missing-array-bound family as {@code PlatformApi}'s
 * {@code allowedEmailDomains}/{@code permissionCodes}/{@code prices}.
 */
@Component
public class TicketsStatusService {

  private static final long DEADLINE_SECONDS = 5;
  private static final int MAX_BULK_TICKET_IDS = 50;

  private final TicketServiceGrpc.TicketServiceBlockingStub stub;

  public TicketsStatusService(
    TicketServiceGrpc.TicketServiceBlockingStub stub
  ) {
    this.stub = stub;
  }

  public ResponseEntity<
    ApiResponse<BulkTicketStatusResponseDto>
  > bulkChangeStatus(RequestContext context, BulkTicketStatusDto dto) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_UPDATE
    );
    requireWithinBulkLimit(dto.getTicketIds());

    BulkTicketStatusRequest.Builder wire = BulkTicketStatusRequest.newBuilder()
      .addAllTicketIds(
        dto.getTicketIds().stream().map(Object::toString).toList()
      )
      .setStatus(
        TicketsCrudService.toProtoTicketStatus(dto.getStatus().getValue())
      );
    if (dto.getReason() != null) {
      wire.setReason(dto.getReason());
    }

    BulkTicketStatusResponse response = withMetadata(
      context
    ).bulkChangeTicketStatus(wire.build());

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Bulk status change processed",
        new BulkTicketStatusResponseDto()
          .updated(response.getUpdatedList())
          .failed(
            response
              .getFailedList()
              .stream()
              .map(TicketsStatusService::toFailureDto)
              .toList()
          )
      )
    );
  }

  public ResponseEntity<
    ApiResponse<BulkTicketPriorityResponseDto>
  > bulkChangePriority(RequestContext context, BulkTicketPriorityDto dto) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_UPDATE
    );
    requireWithinBulkLimit(dto.getTicketIds());

    BulkTicketPriorityRequest wire = BulkTicketPriorityRequest.newBuilder()
      .addAllTicketIds(
        dto.getTicketIds().stream().map(Object::toString).toList()
      )
      .setPriority(
        TicketsCrudService.toProtoTicketPriority(dto.getPriority().getValue())
      )
      .build();

    BulkTicketPriorityResponse response = withMetadata(
      context
    ).bulkChangeTicketPriority(wire);

    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        "Bulk priority change processed",
        new BulkTicketPriorityResponseDto()
          .updated(response.getUpdatedList())
          .failed(
            response
              .getFailedList()
              .stream()
              .map(TicketsStatusService::toFailureDto)
              .toList()
          )
      )
    );
  }

  public ResponseEntity<ApiResponse<TicketResponseDto>> changeStatus(
    RequestContext context,
    String id,
    ChangeTicketStatusDto dto
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_UPDATE
    );

    ChangeTicketStatusRequest.Builder wire =
      ChangeTicketStatusRequest.newBuilder()
        .setId(id)
        .setStatus(
          TicketsCrudService.toProtoTicketStatus(dto.getStatus().getValue())
        );
    if (dto.getReason() != null) {
      wire.setReason(dto.getReason());
    }

    TicketResponse response = withMetadata(context).changeTicketStatus(
      wire.build()
    );

    return ok(response, "Ticket status changed");
  }

  /** Not permission-gated — a correction, not an omission; see the class docblock family in {@link TicketsCrudService}. */
  public ResponseEntity<ApiResponse<TicketResponseDto>> escalate(
    RequestContext context,
    String id,
    TicketStatusActionDto dto
  ) {
    TicketResponse response = withMetadata(context).escalateTicket(
      toActionRequest(id, dto)
    );

    return ok(response, "Ticket escalated");
  }

  public ResponseEntity<ApiResponse<TicketResponseDto>> resolve(
    RequestContext context,
    String id,
    TicketStatusActionDto dto
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_RESOLVE
    );

    TicketResponse response = withMetadata(context).resolveTicket(
      toActionRequest(id, dto)
    );

    return ok(response, "Ticket resolved");
  }

  public ResponseEntity<ApiResponse<TicketResponseDto>> reopen(
    RequestContext context,
    String id,
    TicketStatusActionDto dto
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_UPDATE
    );

    TicketResponse response = withMetadata(context).reopenTicket(
      toActionRequest(id, dto)
    );

    return ok(response, "Ticket reopened");
  }

  public ResponseEntity<ApiResponse<TicketResponseDto>> close(
    RequestContext context,
    String id,
    TicketStatusActionDto dto
  ) {
    TicketsCrudService.requirePermission(
      context,
      PermissionCodesEnum.TICKET_RESOLVE
    );

    TicketResponse response = withMetadata(context).closeTicket(
      toActionRequest(id, dto)
    );

    return ok(response, "Ticket closed");
  }

  private static TicketStatusActionRequest toActionRequest(
    String id,
    TicketStatusActionDto dto
  ) {
    TicketStatusActionRequest.Builder wire =
      TicketStatusActionRequest.newBuilder().setTicketId(id);
    if (dto != null && dto.getReason() != null) {
      wire.setReason(dto.getReason());
    }
    return wire.build();
  }

  private static void requireWithinBulkLimit(List<?> ticketIds) {
    if (ticketIds != null && ticketIds.size() > MAX_BULK_TICKET_IDS) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "ticketIds must contain no more than " +
          MAX_BULK_TICKET_IDS +
          " elements"
      );
    }
  }

  private static BulkTicketFailureResponseDto toFailureDto(
    synapsedesk.ticket.Ticket.BulkTicketFailure failure
  ) {
    return new BulkTicketFailureResponseDto()
      .id(failure.getId())
      .reason(failure.getReason());
  }

  private static ResponseEntity<ApiResponse<TicketResponseDto>> ok(
    TicketResponse response,
    String message
  ) {
    return ResponseEntity.ok(
      ApiResponse.of(
        200,
        message,
        TicketsCrudService.toTicketResponseDto(response)
      )
    );
  }

  private TicketServiceGrpc.TicketServiceBlockingStub withMetadata(
    RequestContext context
  ) {
    return stub
      .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context))
      );
  }
}
