package com.synapsedesk.gateway.tickets;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.CreateTicketDto;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.InvitationsControllerListV1200ResponseDataMeta;
import com.synapsedesk.gateway.generated.model.TicketResponseDto;
import com.synapsedesk.gateway.generated.model.TicketsControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListV1200ResponseData;
import com.synapsedesk.gateway.generated.model.UpdateTicketDto;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.stub.MetadataUtils;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import synapsedesk.auth.Common.PageRequest;
import synapsedesk.auth.Common.SortOrder;
import synapsedesk.ticket.Common.TicketPriority;
import synapsedesk.ticket.Common.TicketResponse;
import synapsedesk.ticket.Common.TicketSource;
import synapsedesk.ticket.Common.TicketStatus;
import synapsedesk.ticket.Ticket.CreateTicketRequest;
import synapsedesk.ticket.Ticket.GetTicketByNumberRequest;
import synapsedesk.ticket.Ticket.GetTicketRequest;
import synapsedesk.ticket.Ticket.ListTicketsRequest;
import synapsedesk.ticket.Ticket.ListTicketsResponse;
import synapsedesk.ticket.Ticket.TicketIdRequest;
import synapsedesk.ticket.Ticket.UpdateTicketRequest;
import synapsedesk.ticket.TicketServiceGrpc;

/**
 * `TicketsApi`'s CRUD-and-plain-reads group (7 of 24 operations) — the
 * first of three sub-passes across this interface, split the same way
 * `PlatformApi` was: a plain {@code @Component}, not yet a {@code
 * @RestController}, because {@code TicketsApi} has 24 abstract methods and
 * a concrete class must implement all of them before Spring registers any
 * route on it.
 *
 * <p><b>Reads are NOT permission-gated</b> — Node's own docblock: an end
 * user with no grants may list and open their own tickets, because raising
 * one is the product's self-service entry point. The narrowing (mine vs.
 * the tenant queue) happens in ticket-service from the caller context in
 * gRPC metadata, never here.
 *
 * <p><b>{@code includeDeleted} is checked in the handler body, not by
 * {@code @RequirePermission}</b> — gating the whole {@code list} route
 * would deny every ordinary user their own ticket list. Reproduced from
 * Node's {@code assertMayIncludeDeleted}: {@code true} passes only for a
 * super admin or a caller holding {@code ticket.delete}; refused rather
 * than silently downgraded to "live tickets only", because a client that
 * asked for the recycle bin and got live rows would show an empty bin and
 * conclude there is nothing to restore.
 *
 * <p><b>{@code update}'s {@code priority} field is NOT optional on the
 * wire</b> — unlike {@code title}/{@code description}. {@code
 * UpdateTicketRequest.priority} has no {@code optional} keyword in the
 * proto, so Node's generated TS type makes it non-omittable and its mapper
 * always computes and sends it (absent DTO value → {@code
 * TICKET_PRIORITY_UNSPECIFIED}). In Java that same requirement needs no
 * special-casing: an implicit-presence field left unset by the builder
 * already serializes to its zero value, byte-identical to explicitly
 * setting {@code TICKET_PRIORITY_UNSPECIFIED} — confirmed by sabotage: an
 * unconditional ternary and the plain {@code if (priority != null)} guard
 * below produced the same captured wire request. ticket-service reads that
 * value the same way every filter in this domain reads it: "no value
 * provided," never "clear the priority."
 */
@Component
public class TicketsCrudService {

  private static final long DEADLINE_SECONDS = 5;

  private final TicketServiceGrpc.TicketServiceBlockingStub stub;

  public TicketsCrudService(TicketServiceGrpc.TicketServiceBlockingStub stub) {
    this.stub = stub;
  }

  public ResponseEntity<TicketsControllerListV1200Response> list(
    RequestContext context,
    BigDecimal page,
    BigDecimal limit,
    String sortOrder,
    String searchTerm,
    String sortBy,
    Boolean includeDeleted,
    String status,
    String priority,
    String source,
    java.util.UUID assigneeId,
    java.util.UUID departmentId,
    java.util.UUID authorId
  ) {
    requireMayIncludeDeleted(context, includeDeleted);

    PageRequest.Builder pageRequest = PageRequest.newBuilder()
      .setPage(page.intValue())
      .setLimit(limit.intValue())
      .setSortBy(sortBy)
      .setSortOrder(
        "DESC".equalsIgnoreCase(sortOrder)
          ? SortOrder.SORT_ORDER_DESC
          : SortOrder.SORT_ORDER_ASC
      );
    if (searchTerm != null) {
      pageRequest.setSearchTerm(searchTerm);
    }

    ListTicketsRequest wire = ListTicketsRequest.newBuilder()
      .setPage(pageRequest)
      .setStatus(toProtoTicketStatus(status))
      .setPriority(toProtoTicketPriority(priority))
      .setSource(toProtoTicketSource(source))
      .setAssigneeId(assigneeId == null ? "" : assigneeId.toString())
      .setDepartmentId(departmentId == null ? "" : departmentId.toString())
      .setAuthorId(authorId == null ? "" : authorId.toString())
      .setIncludeDeleted(includeDeleted != null && includeDeleted)
      .build();

    ListTicketsResponse response = withMetadata(context).listTickets(wire);

    TicketsControllerListV1200ResponseData data =
      new TicketsControllerListV1200ResponseData(
        response
          .getItemsList()
          .stream()
          .map(TicketsCrudService::toTicketResponseDto)
          .toList(),
        toMetaDto(response.getMeta())
      );

    return ResponseEntity.ok(
      new TicketsControllerListV1200Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(200))
        .message("OK")
        .data(data)
    );
  }

  public ResponseEntity<TicketsControllerCreateV1201Response> getByNumber(
    RequestContext context,
    BigDecimal ticketNumber
  ) {
    TicketResponse response = withMetadata(context).getTicketByNumber(
      GetTicketByNumberRequest.newBuilder()
        .setTicketNumber(ticketNumber.longValue())
        .build()
    );

    return ok(response, "OK", HttpStatus.OK);
  }

  public ResponseEntity<TicketsControllerCreateV1201Response> get(
    RequestContext context,
    String id
  ) {
    TicketResponse response = withMetadata(context).getTicket(
      GetTicketRequest.newBuilder().setId(id).build()
    );

    return ok(response, "OK", HttpStatus.OK);
  }

  public ResponseEntity<TicketsControllerCreateV1201Response> create(
    RequestContext context,
    CreateTicketDto dto
  ) {
    requirePermission(context, PermissionCodesEnum.TICKET_CREATE);

    CreateTicketRequest.Builder wire = CreateTicketRequest.newBuilder()
      .setTitle(dto.getTitle())
      .setDescription(dto.getDescription())
      .setPriority(
        dto.getPriority() == null
          ? TicketPriority.TICKET_PRIORITY_UNSPECIFIED
          : toProtoTicketPriority(dto.getPriority().getValue())
      )
      .setSource(
        dto.getSource() == null
          ? TicketSource.TICKET_SOURCE_UNSPECIFIED
          : toProtoTicketSource(dto.getSource().getValue())
      );
    if (dto.getAuthorId() != null) {
      wire.setAuthorId(dto.getAuthorId().toString());
    }

    TicketResponse response = withMetadata(context).createTicket(wire.build());

    return ok(response, "Ticket created", HttpStatus.CREATED);
  }

  public ResponseEntity<TicketsControllerCreateV1201Response> update(
    RequestContext context,
    String id,
    UpdateTicketDto dto
  ) {
    requirePermission(context, PermissionCodesEnum.TICKET_UPDATE);

    UpdateTicketRequest.Builder wire = UpdateTicketRequest.newBuilder().setId(
      id
    );
    if (dto.getPriority() != null) {
      wire.setPriority(toProtoTicketPriority(dto.getPriority().getValue()));
    }
    if (dto.getTitle() != null) {
      wire.setTitle(dto.getTitle());
    }
    if (dto.getDescription() != null) {
      wire.setDescription(dto.getDescription());
    }

    TicketResponse response = withMetadata(context).updateTicket(wire.build());

    return ok(response, "Ticket updated", HttpStatus.OK);
  }

  public ResponseEntity<AuthControllerForgotPasswordV1202Response> remove(
    RequestContext context,
    String id
  ) {
    requirePermission(context, PermissionCodesEnum.TICKET_DELETE);

    withMetadata(context).deleteTicket(
      TicketIdRequest.newBuilder().setId(id).build()
    );

    return ResponseEntity.status(HttpStatus.NO_CONTENT).body(
      new AuthControllerForgotPasswordV1202Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(204))
        .message("OK")
    );
  }

  public ResponseEntity<TicketsControllerCreateV1201Response> restore(
    RequestContext context,
    String id
  ) {
    requirePermission(context, PermissionCodesEnum.TICKET_DELETE);

    TicketResponse response = withMetadata(context).restoreTicket(
      TicketIdRequest.newBuilder().setId(id).build()
    );

    return ok(response, "Ticket restored", HttpStatus.OK);
  }

  /**
   * A plain, imperative ANY-of-one check — the {@code @RequirePermission}
   * annotation only does anything through {@code PermissionInterceptor},
   * which fires for a registered Spring MVC handler method; this class is a
   * plain service with no route attached yet (see the class docblock), so
   * the check is reproduced directly, the same style as {@link
   * #requireMayIncludeDeleted}.
   */
  static void requirePermission(
    RequestContext context,
    PermissionCodesEnum code
  ) {
    if (context.isSuperAdmin()) {
      return;
    }
    if (context.permissionCodes().contains(code.getValue())) {
      return;
    }
    throw new ResponseStatusException(
      HttpStatus.FORBIDDEN,
      "Requires: " + code.getValue()
    );
  }

  /** Node's `assertMayIncludeDeleted`: refused, never silently downgraded. */
  private static void requireMayIncludeDeleted(
    RequestContext context,
    Boolean includeDeleted
  ) {
    if (!Boolean.TRUE.equals(includeDeleted)) {
      return;
    }
    if (context.isSuperAdmin()) {
      return;
    }
    if (
      context
        .permissionCodes()
        .contains(PermissionCodesEnum.TICKET_DELETE.getValue())
    ) {
      return;
    }
    throw new ResponseStatusException(
      HttpStatus.FORBIDDEN,
      "Viewing deleted tickets requires the ticket.delete permission"
    );
  }

  private static ResponseEntity<TicketsControllerCreateV1201Response> ok(
    TicketResponse response,
    String message,
    HttpStatus status
  ) {
    return ResponseEntity.status(status).body(
      new TicketsControllerCreateV1201Response()
        .success(true)
        .statusCode(BigDecimal.valueOf(status.value()))
        .message(message)
        .data(toTicketResponseDto(response))
    );
  }

  static TicketStatus toProtoTicketStatus(String value) {
    if (value == null) {
      return TicketStatus.TICKET_STATUS_UNSPECIFIED;
    }
    try {
      return TicketStatus.valueOf("TICKET_STATUS_" + value);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "status must be a recognized ticket status"
      );
    }
  }

  static TicketPriority toProtoTicketPriority(String value) {
    if (value == null) {
      return TicketPriority.TICKET_PRIORITY_UNSPECIFIED;
    }
    try {
      return TicketPriority.valueOf("TICKET_PRIORITY_" + value);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "priority must be a recognized ticket priority"
      );
    }
  }

  private static TicketSource toProtoTicketSource(String value) {
    if (value == null) {
      return TicketSource.TICKET_SOURCE_UNSPECIFIED;
    }
    try {
      return TicketSource.valueOf("TICKET_SOURCE_" + value);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "source must be a recognized ticket source"
      );
    }
  }

  static TicketResponseDto toTicketResponseDto(TicketResponse ticket) {
    return new TicketResponseDto()
      .id(ticket.getId())
      .ticketNumber(BigDecimal.valueOf(ticket.getTicketNumber()))
      .organizationId(ticket.getOrganizationId())
      .authorId(ticket.getAuthorId())
      .source(
        TicketResponseDto.SourceEnum.fromValue(
          ticket.getSource().name().replace("TICKET_SOURCE_", "")
        )
      )
      .status(
        TicketResponseDto.StatusEnum.fromValue(
          ticket.getStatus().name().replace("TICKET_STATUS_", "")
        )
      )
      .priority(
        TicketResponseDto.PriorityEnum.fromValue(
          ticket.getPriority().name().replace("TICKET_PRIORITY_", "")
        )
      )
      .title(ticket.getTitle())
      .description(ticket.getDescription())
      .currentAssigneeId(
        ticket.hasCurrentAssigneeId() ? ticket.getCurrentAssigneeId() : null
      )
      .currentDepartmentId(
        ticket.hasCurrentDepartmentId() ? ticket.getCurrentDepartmentId() : null
      )
      .escalatedAt(
        ticket.hasEscalatedAt()
          ? toOffsetDateTime(ticket.getEscalatedAt())
          : null
      )
      .resolvedAt(
        ticket.hasResolvedAt() ? toOffsetDateTime(ticket.getResolvedAt()) : null
      )
      .unreadCount(BigDecimal.valueOf(ticket.getUnreadCount()))
      .createdAt(toOffsetDateTime(ticket.getCreatedAt()))
      .updatedAt(toOffsetDateTime(ticket.getUpdatedAt()))
      .deletedAt(
        ticket.hasDeletedAt() ? toOffsetDateTime(ticket.getDeletedAt()) : null
      )
      .deletedById(ticket.hasDeletedById() ? ticket.getDeletedById() : null);
  }

  private static InvitationsControllerListV1200ResponseDataMeta toMetaDto(
    synapsedesk.auth.Common.PageMeta meta
  ) {
    return new InvitationsControllerListV1200ResponseDataMeta(
      BigDecimal.valueOf(meta.getTotalItems()),
      BigDecimal.valueOf(meta.getItemCount()),
      BigDecimal.valueOf(meta.getItemsPerPage()),
      BigDecimal.valueOf(meta.getTotalPages()),
      BigDecimal.valueOf(meta.getCurrentPage())
    );
  }

  static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }

  static com.google.protobuf.Timestamp toTimestamp(OffsetDateTime dateTime) {
    java.time.Instant instant = dateTime.toInstant();
    return com.google.protobuf.Timestamp.newBuilder()
      .setSeconds(instant.getEpochSecond())
      .setNanos(instant.getNano())
      .build();
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
