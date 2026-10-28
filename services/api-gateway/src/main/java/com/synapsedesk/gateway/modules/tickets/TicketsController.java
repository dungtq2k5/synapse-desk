package com.synapsedesk.gateway.modules.tickets;

import com.synapsedesk.gateway.common.auth.CurrentRequest;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.dto.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.common.dto.ExportResponseDto;
import com.synapsedesk.gateway.common.grpc.CallerMetadata;
import com.synapsedesk.gateway.common.openapi.ApiErrors;
import com.synapsedesk.gateway.common.security.RequirePermission;
import com.synapsedesk.gateway.common.web.ApiPaths;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.common.web.PagedData;
import com.synapsedesk.gateway.common.web.SortDirection;
import com.synapsedesk.gateway.modules.tickets.dto.rest.AssignTicketDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.AssignTicketToSelfDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.AssignmentResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.BulkTicketPriorityDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.BulkTicketPriorityResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.BulkTicketStatusDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.BulkTicketStatusResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.ChangeTicketStatusDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.CreateTicketDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.CreateTicketExportDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.CreateTicketResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.MarkTicketReadDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.MarkTicketReadResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.PresignAttachmentResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.SimilarTicketResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketPriorityFilter;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketSortField;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketSourceFilter;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketStatusActionDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketStatusChangeResponseDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.TicketStatusFilter;
import com.synapsedesk.gateway.modules.tickets.dto.rest.UpdateTicketDto;
import com.synapsedesk.gateway.modules.tickets.dto.rest.UploadAttachmentDto;
import io.grpc.stub.MetadataUtils;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import synapsedesk.ticket.Message.PresignAttachmentResponse;
import synapsedesk.ticket.Message.UploadAttachmentRequest;
import synapsedesk.ticket.MessageServiceGrpc;

/**
 * `TicketsApi` — the routed assembly of all 23 ticket operations, delegating
 * to the four group-scoped services this interface was ported across:
 * {@link TicketsCrudService} (CRUD + plain reads, 7 ops), {@link
 * TicketsStatusService} (status state machine + bulk ops, 7 ops), {@link
 * TicketsAssignmentService} (assignment triple + read-state/history, 7
 * ops), and {@link TicketsExportAndAiService} (export + AI-similar, 3
 * ops). The hand-declared {@code @RequestMapping}s live here, and only
 * here, matching {@code PlatformController}'s own assembly pattern.
 *
 * <p><b>{@code @RequirePermission} lives here, not only in the services.</b>
 * The four group services call {@code TicketsCrudService.requirePermission}
 * imperatively because they had no registered route to hang a real
 * annotation on while unrouted — {@code PermissionInterceptor} only fires
 * for a method Spring has actually mapped. Now that this class IS that
 * route, the real annotation is what the permission registry check
 * (`test/gateway-contract/permission-coverage.contract-spec.ts`, which reads
 * this source text against `test/fixtures/permissions/rest-routes.json`, not
 * behaviour) can see,
 * and what `PermissionInterceptor` actually enforces on the wire. The
 * service-layer checks stay: they are what each group's own sabotage tests
 * exercise directly, and a second, redundant guard on the HTTP path costs
 * nothing.
 *
 * <p><b>Migrated off `TicketsApi`.</b> {@code create} answers 201; {@code
 * createExport} answers 202; {@code remove} and {@code unassign} answer
 * 204 — {@code @ResponseStatus} is what tells springdoc that. {@code
 * assign}/{@code reassign}/{@code assignToSelf}/{@code unassign} keep
 * their four independent, non-shared {@code @RequirePermission} codes
 * exactly as before — the sibling-code risk this whole group split existed
 * for, unchanged by the flip.
 */
@Tag(name = "Tickets")
@RestController
@RequestMapping(ApiPaths.V1)
@Validated
public class TicketsController {

  private final CurrentUser currentUser;
  private final TicketsCrudService crud;
  private final TicketsStatusService status;
  private final TicketsAssignmentService assignment;
  private final TicketsExportAndAiService exportAndAi;
  private final MessageServiceGrpc.MessageServiceBlockingStub messages;

  public TicketsController(
    CurrentUser currentUser,
    TicketsCrudService crud,
    TicketsStatusService status,
    TicketsAssignmentService assignment,
    TicketsExportAndAiService exportAndAi,
    MessageServiceGrpc.MessageServiceBlockingStub messages
  ) {
    this.currentUser = currentUser;
    this.crud = crud;
    this.status = status;
    this.assignment = assignment;
    this.exportAndAi = exportAndAi;
    this.messages = messages;
  }

  private RequestContext context() {
    return currentUser.require(CurrentRequest.request());
  }

  @GetMapping(value = "/tickets", produces = { "application/json" })
  @ApiErrors({ "401" })
  public ResponseEntity<
    ApiResponse<PagedData<TicketResponseDto>>
  > ticketsControllerListV1(
    @DecimalMin(value = "1") @Valid @RequestParam(
      value = "page",
      required = false,
      defaultValue = "1"
    ) BigDecimal page,
    @DecimalMin(value = "1") @DecimalMax(value = "100") @Valid @RequestParam(
      value = "limit",
      required = false,
      defaultValue = "10"
    ) BigDecimal limit,
    @Valid @RequestParam(
      value = "sortOrder",
      required = false,
      defaultValue = "ASC"
    ) SortDirection sortOrder,
    @Valid @RequestParam(
      value = "searchTerm",
      required = false
    ) @Nullable String searchTerm,
    @Valid @RequestParam(
      value = "sortBy",
      required = false,
      defaultValue = "createdAt"
    ) TicketSortField sortBy,
    @Valid @RequestParam(
      value = "includeDeleted",
      required = false,
      defaultValue = "false"
    ) Boolean includeDeleted,
    @Valid @RequestParam(
      value = "status",
      required = false
    ) @Nullable TicketStatusFilter statusFilter,
    @Valid @RequestParam(
      value = "priority",
      required = false
    ) @Nullable TicketPriorityFilter priorityFilter,
    @Valid @RequestParam(
      value = "source",
      required = false
    ) @Nullable TicketSourceFilter sourceFilter,
    @Valid @RequestParam(
      value = "assigneeId",
      required = false
    ) @Nullable UUID assigneeId,
    @Valid @RequestParam(
      value = "departmentId",
      required = false
    ) @Nullable UUID departmentId,
    @Valid @RequestParam(
      value = "authorId",
      required = false
    ) @Nullable UUID authorId
  ) {
    String status = statusFilter == null ? null : statusFilter.name();
    String priority = priorityFilter == null ? null : priorityFilter.name();
    String source = sourceFilter == null ? null : sourceFilter.name();
    return crud.list(
      context(),
      page,
      limit,
      sortOrder.name(),
      searchTerm,
      sortBy.name(),
      includeDeleted,
      status,
      priority,
      source,
      assigneeId,
      departmentId,
      authorId
    );
  }

  @GetMapping(
    value = "/tickets/by-number/{ticketNumber}",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerGetByNumberV1(
    @PathVariable("ticketNumber") BigDecimal ticketNumber
  ) {
    return crud.getByNumber(context(), ticketNumber);
  }

  @GetMapping(value = "/tickets/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<ApiResponse<TicketResponseDto>> ticketsControllerGetV1(
    @PathVariable("id") String id
  ) {
    return crud.get(context(), id);
  }

  @PostMapping(
    value = "/tickets",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission(PermissionCodesEnum.TICKET_CREATE)
  public ResponseEntity<
    ApiResponse<CreateTicketResponseDto>
  > ticketsControllerCreateV1(
    @Valid @RequestBody CreateTicketDto createTicketDto
  ) {
    return crud.create(context(), createTicketDto);
  }

  /**
   * Presigns a file for a ticket that doesn't exist yet: its opening, sent
   * with {@code POST /tickets} or {@code POST /chat/conversations} as
   * {@code attachments}.
   *
   * <p>The file is the caller's own until a create binds it, and only theirs
   * can bind it, so the caller is all there is to authorize: the tenant's size
   * limit is checked, and no ticket is loaded. 200, not 201: nothing exists
   * yet but permission to upload.
   */
  @PostMapping(
    value = "/tickets/attachments/upload-url",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401" })
  public ResponseEntity<
    ApiResponse<PresignAttachmentResponseDto>
  > ticketsControllerPresignOpeningAttachmentV1(
    @Valid @RequestBody UploadAttachmentDto uploadAttachmentDto
  ) {
    PresignAttachmentResponse response = messages
      .withDeadlineAfter(5, TimeUnit.SECONDS)
      .withInterceptors(
        MetadataUtils.newAttachHeadersInterceptor(CallerMetadata.of(context()))
      )
      .uploadAttachment(
        UploadAttachmentRequest.newBuilder()
          .setFileName(uploadAttachmentDto.getFileName())
          .setFileSizeBytes(uploadAttachmentDto.getFileSizeBytes().longValue())
          .setMimeType(uploadAttachmentDto.getMimeType().getValue())
          .build()
      );

    return ResponseEntity.ok(
      ApiResponse.of(200, "OK", MessagesController.toPresignData(response))
    );
  }

  @PatchMapping(
    value = "/tickets/{id}",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerUpdateV1(
    @PathVariable("id") String id,
    @Valid @RequestBody UpdateTicketDto updateTicketDto
  ) {
    return crud.update(context(), id, updateTicketDto);
  }

  @DeleteMapping(value = "/tickets/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCodesEnum.TICKET_DELETE)
  public ResponseEntity<ApiResponse<Void>> ticketsControllerRemoveV1(
    @PathVariable("id") String id
  ) {
    return crud.remove(context(), id);
  }

  @PostMapping(
    value = "/tickets/{id}/restore",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_DELETE)
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerRestoreV1(@PathVariable("id") String id) {
    return crud.restore(context(), id);
  }

  @PostMapping(
    value = "/tickets/bulk/status",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<
    ApiResponse<BulkTicketStatusResponseDto>
  > ticketsControllerBulkChangeStatusV1(
    @Valid @RequestBody BulkTicketStatusDto bulkTicketStatusDto
  ) {
    return status.bulkChangeStatus(context(), bulkTicketStatusDto);
  }

  @PostMapping(
    value = "/tickets/bulk/priority",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<
    ApiResponse<BulkTicketPriorityResponseDto>
  > ticketsControllerBulkChangePriorityV1(
    @Valid @RequestBody BulkTicketPriorityDto bulkTicketPriorityDto
  ) {
    return status.bulkChangePriority(context(), bulkTicketPriorityDto);
  }

  @PostMapping(
    value = "/tickets/{id}/status",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerChangeStatusV1(
    @PathVariable("id") String id,
    @Valid @RequestBody ChangeTicketStatusDto changeTicketStatusDto
  ) {
    return status.changeStatus(context(), id, changeTicketStatusDto);
  }

  @PostMapping(
    value = "/tickets/{id}/escalate",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerEscalateV1(
    @PathVariable("id") String id,
    @Valid @RequestBody TicketStatusActionDto ticketStatusActionDto
  ) {
    return status.escalate(context(), id, ticketStatusActionDto);
  }

  @PostMapping(
    value = "/tickets/{id}/resolve",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_RESOLVE)
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerResolveV1(
    @PathVariable("id") String id,
    @Valid @RequestBody TicketStatusActionDto ticketStatusActionDto
  ) {
    return status.resolve(context(), id, ticketStatusActionDto);
  }

  @PostMapping(
    value = "/tickets/{id}/reopen",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerReopenV1(
    @PathVariable("id") String id,
    @Valid @RequestBody TicketStatusActionDto ticketStatusActionDto
  ) {
    return status.reopen(context(), id, ticketStatusActionDto);
  }

  @PostMapping(
    value = "/tickets/{id}/close",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_RESOLVE)
  public ResponseEntity<
    ApiResponse<TicketResponseDto>
  > ticketsControllerCloseV1(
    @PathVariable("id") String id,
    @Valid @RequestBody TicketStatusActionDto ticketStatusActionDto
  ) {
    return status.close(context(), id, ticketStatusActionDto);
  }

  @PostMapping(
    value = "/tickets/{id}/assign",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_ASSIGN)
  public ResponseEntity<
    ApiResponse<AssignmentResponseDto>
  > ticketsControllerAssignV1(
    @PathVariable("id") String id,
    @Valid @RequestBody AssignTicketDto assignTicketDto
  ) {
    return assignment.assign(context(), id, assignTicketDto);
  }

  @PostMapping(
    value = "/tickets/{id}/reassign",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_REASSIGN)
  public ResponseEntity<
    ApiResponse<AssignmentResponseDto>
  > ticketsControllerReassignV1(
    @PathVariable("id") String id,
    @Valid @RequestBody AssignTicketDto assignTicketDto
  ) {
    return assignment.reassign(context(), id, assignTicketDto);
  }

  @PostMapping(
    value = "/tickets/{id}/assign/self",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_ASSIGN_SELF)
  public ResponseEntity<
    ApiResponse<AssignmentResponseDto>
  > ticketsControllerAssignToSelfV1(
    @PathVariable("id") String id,
    @Valid @RequestBody AssignTicketToSelfDto assignTicketToSelfDto
  ) {
    return assignment.assignToSelf(context(), id, assignTicketToSelfDto);
  }

  @DeleteMapping(
    value = "/tickets/{id}/assign",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @ResponseStatus(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCodesEnum.TICKET_ASSIGN)
  public ResponseEntity<ApiResponse<Void>> ticketsControllerUnassignV1(
    @PathVariable("id") String id
  ) {
    return assignment.unassign(context(), id);
  }

  @GetMapping(
    value = "/tickets/{id}/assignments",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<List<AssignmentResponseDto>>
  > ticketsControllerListAssignmentsV1(@PathVariable("id") String id) {
    return assignment.listAssignments(context(), id);
  }

  @PostMapping(
    value = "/tickets/{id}/read",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<MarkTicketReadResponseDto>
  > ticketsControllerMarkReadV1(
    @PathVariable("id") String id,
    @Valid @RequestBody MarkTicketReadDto markTicketReadDto
  ) {
    return assignment.markRead(context(), id, markTicketReadDto);
  }

  @GetMapping(
    value = "/tickets/{id}/history",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "404" })
  public ResponseEntity<
    ApiResponse<List<TicketStatusChangeResponseDto>>
  > ticketsControllerListStatusChangesV1(@PathVariable("id") String id) {
    return assignment.listStatusChanges(context(), id);
  }

  @PostMapping(
    value = "/tickets/export",
    produces = { "application/json" },
    consumes = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403" })
  @ResponseStatus(HttpStatus.ACCEPTED)
  @RequirePermission(PermissionCodesEnum.TICKET_EXPORT)
  public ResponseEntity<
    ApiResponse<ExportResponseDto>
  > ticketsControllerCreateExportV1(
    @Valid @RequestBody CreateTicketExportDto createTicketExportDto
  ) {
    return exportAndAi.createExport(context(), createTicketExportDto);
  }

  @GetMapping(value = "/tickets/export/{id}", produces = { "application/json" })
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_EXPORT)
  public ResponseEntity<
    ApiResponse<ExportResponseDto>
  > ticketsControllerGetExportV1(@PathVariable("id") String id) {
    return exportAndAi.getExport(context(), id);
  }

  @GetMapping(
    value = "/tickets/{id}/similar",
    produces = { "application/json" }
  )
  @ApiErrors({ "400", "401", "403", "404" })
  @RequirePermission(PermissionCodesEnum.TICKET_READ_ALL)
  public ResponseEntity<
    ApiResponse<List<SimilarTicketResponseDto>>
  > ticketsControllerListSimilarV1(@PathVariable("id") String id) {
    return exportAndAi.listSimilar(context(), id);
  }
}
