package com.synapsedesk.gateway.tickets;

import com.synapsedesk.gateway.auth.CurrentRequest;
import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.generated.api.TicketsApi;
import com.synapsedesk.gateway.generated.model.AssignTicketDto;
import com.synapsedesk.gateway.generated.model.AssignTicketToSelfDto;
import com.synapsedesk.gateway.generated.model.AuthControllerForgotPasswordV1202Response;
import com.synapsedesk.gateway.generated.model.BulkTicketPriorityDto;
import com.synapsedesk.gateway.generated.model.BulkTicketStatusDto;
import com.synapsedesk.gateway.generated.model.ChangeTicketStatusDto;
import com.synapsedesk.gateway.generated.model.CreateTicketDto;
import com.synapsedesk.gateway.generated.model.CreateTicketExportDto;
import com.synapsedesk.gateway.generated.model.MarkTicketReadDto;
import com.synapsedesk.gateway.generated.model.TicketStatusActionDto;
import com.synapsedesk.gateway.generated.model.TicketsControllerAssignV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerBulkChangePriorityV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerBulkChangeStatusV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerCreateExportV1202Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerCreateV1201Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListAssignmentsV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListSimilarV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListStatusChangesV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerListV1200Response;
import com.synapsedesk.gateway.generated.model.TicketsControllerMarkReadV1200Response;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import com.synapsedesk.gateway.generated.model.UpdateTicketDto;
import com.synapsedesk.gateway.security.RequirePermission;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.web.bind.annotation.RestController;

/**
 * `TicketsApi` — the routed assembly of all 24 ticket operations, delegating
 * to the four group-scoped services this interface was ported across:
 * {@link TicketsCrudService} (CRUD + plain reads, 7 ops), {@link
 * TicketsStatusService} (status state machine + bulk ops, 7 ops), {@link
 * TicketsAssignmentService} (assignment triple + read-state/history, 7
 * ops), and {@link TicketsExportAndAiService} (export + AI-similar, 3
 * ops). {@code implements TicketsApi} lives here, and only here, because a
 * generated interface's 24 abstract methods all need an implementation
 * before Spring can register any route on it — the four services above
 * carried real, sabotage-tested logic with no route attached until this
 * class existed, matching {@code PlatformController}'s own assembly
 * pattern for {@code PlatformApi}.
 *
 * <p><b>{@code @RequirePermission} lives here, not only in the services.</b>
 * The four group services call {@code TicketsCrudService.requirePermission}
 * imperatively because they had no registered route to hang a real
 * annotation on while unrouted — {@code PermissionInterceptor} only fires
 * for a method Spring has actually mapped. Now that this class IS that
 * route, the real annotation is what the platform's generic
 * permission-parity check (`permission-coverage.contract-spec.ts`, which
 * reads Node's decorators and Java's source text, not behaviour) can see,
 * and what `PermissionInterceptor` actually enforces on the wire. The
 * service-layer checks stay: they are what each group's own sabotage tests
 * exercise directly, and a second, redundant guard on the HTTP path costs
 * nothing.
 */
@RestController
public class TicketsController implements TicketsApi {

  private final CurrentUser currentUser;
  private final TicketsCrudService crud;
  private final TicketsStatusService status;
  private final TicketsAssignmentService assignment;
  private final TicketsExportAndAiService exportAndAi;

  public TicketsController(
      CurrentUser currentUser,
      TicketsCrudService crud,
      TicketsStatusService status,
      TicketsAssignmentService assignment,
      TicketsExportAndAiService exportAndAi) {
    this.currentUser = currentUser;
    this.crud = crud;
    this.status = status;
    this.assignment = assignment;
    this.exportAndAi = exportAndAi;
  }

  private RequestContext context() {
    return currentUser.require(CurrentRequest.request());
  }

  @Override
  public ResponseEntity<TicketsControllerListV1200Response> ticketsControllerListV1(
      BigDecimal page, BigDecimal limit, String sortOrder, @Nullable String searchTerm, String sortBy,
      Boolean includeDeleted, @Nullable String status, @Nullable String priority, @Nullable String source,
      @Nullable UUID assigneeId, @Nullable UUID departmentId, @Nullable UUID authorId) {
    return crud.list(
        context(), page, limit, sortOrder, searchTerm, sortBy, includeDeleted, status, priority, source, assigneeId,
        departmentId, authorId);
  }

  @Override
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerGetByNumberV1(BigDecimal ticketNumber) {
    return crud.getByNumber(context(), ticketNumber);
  }

  @Override
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerGetV1(String id) {
    return crud.get(context(), id);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_CREATE)
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerCreateV1(CreateTicketDto createTicketDto) {
    return crud.create(context(), createTicketDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerUpdateV1(
      String id, UpdateTicketDto updateTicketDto) {
    return crud.update(context(), id, updateTicketDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_DELETE)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> ticketsControllerRemoveV1(String id) {
    return crud.remove(context(), id);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_DELETE)
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerRestoreV1(String id) {
    return crud.restore(context(), id);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<TicketsControllerBulkChangeStatusV1200Response> ticketsControllerBulkChangeStatusV1(
      BulkTicketStatusDto bulkTicketStatusDto) {
    return status.bulkChangeStatus(context(), bulkTicketStatusDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<TicketsControllerBulkChangePriorityV1200Response> ticketsControllerBulkChangePriorityV1(
      BulkTicketPriorityDto bulkTicketPriorityDto) {
    return status.bulkChangePriority(context(), bulkTicketPriorityDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerChangeStatusV1(
      String id, ChangeTicketStatusDto changeTicketStatusDto) {
    return status.changeStatus(context(), id, changeTicketStatusDto);
  }

  @Override
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerEscalateV1(
      String id, TicketStatusActionDto ticketStatusActionDto) {
    return status.escalate(context(), id, ticketStatusActionDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_RESOLVE)
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerResolveV1(
      String id, TicketStatusActionDto ticketStatusActionDto) {
    return status.resolve(context(), id, ticketStatusActionDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_UPDATE)
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerReopenV1(
      String id, TicketStatusActionDto ticketStatusActionDto) {
    return status.reopen(context(), id, ticketStatusActionDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_RESOLVE)
  public ResponseEntity<TicketsControllerCreateV1201Response> ticketsControllerCloseV1(
      String id, TicketStatusActionDto ticketStatusActionDto) {
    return status.close(context(), id, ticketStatusActionDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_ASSIGN)
  public ResponseEntity<TicketsControllerAssignV1200Response> ticketsControllerAssignV1(
      String id, AssignTicketDto assignTicketDto) {
    return assignment.assign(context(), id, assignTicketDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_REASSIGN)
  public ResponseEntity<TicketsControllerAssignV1200Response> ticketsControllerReassignV1(
      String id, AssignTicketDto assignTicketDto) {
    return assignment.reassign(context(), id, assignTicketDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_ASSIGN_SELF)
  public ResponseEntity<TicketsControllerAssignV1200Response> ticketsControllerAssignToSelfV1(
      String id, AssignTicketToSelfDto assignTicketToSelfDto) {
    return assignment.assignToSelf(context(), id, assignTicketToSelfDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_ASSIGN)
  public ResponseEntity<AuthControllerForgotPasswordV1202Response> ticketsControllerUnassignV1(String id) {
    return assignment.unassign(context(), id);
  }

  @Override
  public ResponseEntity<TicketsControllerListAssignmentsV1200Response> ticketsControllerListAssignmentsV1(String id) {
    return assignment.listAssignments(context(), id);
  }

  @Override
  public ResponseEntity<TicketsControllerMarkReadV1200Response> ticketsControllerMarkReadV1(
      String id, MarkTicketReadDto markTicketReadDto) {
    return assignment.markRead(context(), id, markTicketReadDto);
  }

  @Override
  public ResponseEntity<TicketsControllerListStatusChangesV1200Response> ticketsControllerListStatusChangesV1(String id) {
    return assignment.listStatusChanges(context(), id);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_EXPORT)
  public ResponseEntity<TicketsControllerCreateExportV1202Response> ticketsControllerCreateExportV1(
      CreateTicketExportDto createTicketExportDto) {
    return exportAndAi.createExport(context(), createTicketExportDto);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_EXPORT)
  public ResponseEntity<TicketsControllerCreateExportV1202Response> ticketsControllerGetExportV1(String id) {
    return exportAndAi.getExport(context(), id);
  }

  @Override
  @RequirePermission(PermissionCodesEnum.TICKET_READ_ALL)
  public ResponseEntity<TicketsControllerListSimilarV1200Response> ticketsControllerListSimilarV1(String id) {
    return exportAndAi.listSimilar(context(), id);
  }
}
