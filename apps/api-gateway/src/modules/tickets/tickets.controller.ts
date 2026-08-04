import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { TicketsGrpcClient } from './tickets-grpc.client';
import { AssignmentsGrpcClient } from './assignments-grpc.client';
import { AiGrpcClient } from './ai-grpc.client';
import {
  BulkTicketStatusDto,
  ChangeTicketStatusDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  UpdateTicketDto,
} from './dto/rest/ticket.dto';
import {
  BulkTicketStatusResponseDto,
  TicketResponseDto,
} from './dto/rest/ticket-response.dto';
import {
  AssignTicketDto,
  AssignTicketToSelfDto,
} from './dto/rest/assignment.dto';
import { AssignmentResponseDto } from './dto/rest/assignment-response.dto';
import { SimilarTicketDto } from './dto/rest/ai-response.dto';

/**
 * Tickets (api-endpoints-plan §2.1).
 *
 * The tenant is never a parameter — it travels in the caller's verified context
 * — and neither is the caller's identity, which matters more here than in
 * Domain A: the service's visibility filter reads `sub` and `permissionCodes`
 * to decide whether this is "my tickets" or "the whole queue".
 *
 * **Reads are NOT gated on `ticket.read.all`.** An end user with no
 * permissions at all may list and open their own tickets — raising one is the
 * product's entry point, and requiring a grant to see the reply would make the
 * self-service flow unusable. The narrowing happens in ticket-service, which
 * returns only what the caller authored or is assigned. `ticket.read.all` is
 * what WIDENS that to the tenant queue.
 */
@Controller('tickets')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class TicketsController {
  constructor(
    private readonly ticketsGrpcClient: TicketsGrpcClient,
    private readonly assignmentsGrpcClient: AssignmentsGrpcClient,
    private readonly aiGrpcClient: AiGrpcClient,
  ) {}

  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListTicketsQueryDto,
  ): Promise<PaginationResponseBase<TicketResponseDto>> {
    // `includeDeleted` needs the module's MANAGE permission, not its read one.
    // Checked here rather than with a second `@RequirePermission` because that
    // decorator gates the whole ROUTE, and gating this route would deny every
    // end user their own ticket list.
    this.assertMayIncludeDeleted(context, query);

    return this.ticketsGrpcClient.list(query, context);
  }

  /**
   * Declared BEFORE `@Get(':id')`.
   *
   * Nest matches routes in declaration order, and `:id` would swallow
   * `by-number/4211` — then `ParseUUIDPipe` would turn it into a 400 that looks
   * like a client bug. The same ordering hazard `/users/invitations` hit in
   * Domain A.
   */
  @Get('by-number/:ticketNumber')
  getByNumber(
    @CurrentUser() context: RequestContext,
    @Param('ticketNumber', ParseIntPipe) ticketNumber: number,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.getByNumber(ticketNumber, context);
  }

  @Get(':id')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.get(id, context);
  }

  @Post()
  @RequirePermission('ticket.create')
  @ResponseMessage('Ticket created')
  create(
    @CurrentUser() context: RequestContext,
    @Body() dto: CreateTicketDto,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.create(dto, context);
  }

  @Patch(':id')
  @RequirePermission('ticket.update')
  @ResponseMessage('Ticket updated')
  update(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.update(id, dto, context);
  }

  // -------------------------------------------------------------------------
  // The state machine. Five routes, one validator in the service.
  // -------------------------------------------------------------------------

  /**
   * Declared BEFORE every `:id/...` route.
   *
   * `@Post(':id/status')` matches `bulk/status` — `bulk` is a perfectly good
   * `:id` as far as the router is concerned — and `ParseUUIDPipe` then turns it
   * into a 400 that reads as a malformed request rather than a routing
   * mistake. Same hazard as `by-number` above, and it was made here first.
   *
   * Partial success, always 200.
   *
   * Never a 207 or a 4xx when some ids fail: the operation itself succeeded —
   * it processed every id and is reporting what happened to each. A status code
   * cannot express "3 of 4", so the BODY does, and a client reads `failed[]`
   * rather than branching on the status.
   */
  @Post('bulk/status')
  @RequirePermission('ticket.update')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Bulk status change processed')
  bulkChangeStatus(
    @CurrentUser() context: RequestContext,
    @Body() dto: BulkTicketStatusDto,
  ): Promise<BulkTicketStatusResponseDto> {
    return this.ticketsGrpcClient.bulkChangeStatus(dto, context);
  }

  @Post(':id/status')
  @RequirePermission('ticket.update')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket status changed')
  changeStatus(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTicketStatusDto,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.changeStatus(id, dto, context);
  }

  /**
   * Separate routes rather than one with a status body, so each carries its own
   * permission — escalating and resolving are different rights, and a single
   * `ticket.update` gate would grant both to anyone who could rename a ticket.
   */
  /**
   * NOT permission-gated, and that is a correction rather than an omission.
   *
   * api-endpoints-plan §2.1 marks escalation `USER` on both this route and its
   * `/chat` alias, because "one-click hand-off to a human" is the self-service
   * product's core affordance — a customer who needs a person cannot be made to
   * wait for an administrator to grant them the right to ask for one.
   *
   * The real bound is the visibility filter, which is stronger than a
   * permission would be here: you can only escalate a ticket you can already
   * see, which for an end user means their own. `ticket.escalate` remains in
   * the catalogue for a future agent-facing escalation flow that acts on
   * SOMEBODY ELSE'S ticket; this route is not that.
   */
  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket escalated')
  escalate(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.escalate(id, context);
  }

  @Post(':id/resolve')
  @RequirePermission('ticket.resolve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket resolved')
  resolve(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.resolve(id, context);
  }

  @Post(':id/reopen')
  @RequirePermission('ticket.update')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket reopened')
  reopen(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.reopen(id, context);
  }

  @Post(':id/close')
  @RequirePermission('ticket.resolve')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket closed')
  close(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.close(id, context);
  }

  /**
   * Past tickets resembling this one — an agent co-pilot affordance.
   *
   * `ticket.read.all` rather than `ticket.ai.use`: the RESULTS are other
   * people's tickets, so the permission that matters is the one governing who
   * may read the queue. Gating it on the AI grant instead would let someone
   * with a generation budget but no queue access read ticket titles they have
   * no business seeing.
   *
   * 503 today — rag-service is not started.
   */
  @Get(':id/similar')
  @RequirePermission('ticket.read.all')
  listSimilar(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SimilarTicketDto[]> {
    return this.aiGrpcClient.listSimilarTickets(id, context);
  }

  // -------------------------------------------------------------------------
  // Assignment. Three verbs, one write path in the service.
  // -------------------------------------------------------------------------

  /**
   * Assign OR reassign — the same endpoint.
   *
   * Not two routes, because which one a call IS depends on whether the ticket
   * currently has an assignee, and that is a fact the server holds. Asking the
   * client to know it would mean a client that guessed wrong got an error for
   * something it had no way to check without a prior read.
   */
  @Post(':id/assign')
  @RequirePermission('ticket.assign')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket assigned')
  assign(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ): Promise<AssignmentResponseDto> {
    return this.assignmentsGrpcClient.assign(id, dto, context);
  }

  /**
   * The SAME operation as `assign`, behind a different permission.
   *
   * api-endpoints-plan §2.3b gives reassignment its own grant (`ticket.reassign`)
   * because taking work OFF an agent is a different call from handing out
   * unclaimed work. The service still decides assign-vs-reassign from the
   * ticket's state, so the two routes cannot disagree about what happened —
   * only about who is allowed to ask.
   */
  @Post(':id/reassign')
  @RequirePermission('ticket.reassign')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket reassigned')
  reassign(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ): Promise<AssignmentResponseDto> {
    return this.assignmentsGrpcClient.reassign(id, dto, context);
  }

  /**
   * `ticket.assign.self`, NOT `ticket.assign` — the whole reason this is a
   * separate route. Claiming work from a queue is something every agent does;
   * handing work to somebody else is a supervisor's right, and one permission
   * covering both would grant the second to everyone who needed the first.
   */
  @Post(':id/assign/self')
  @RequirePermission('ticket.assign.self')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket claimed')
  assignToSelf(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketToSelfDto,
  ): Promise<AssignmentResponseDto> {
    return this.assignmentsGrpcClient.assignToSelf(id, dto, context);
  }

  @Delete(':id/assign')
  @RequirePermission('ticket.assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  unassign(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.assignmentsGrpcClient.unassign(id, context);
  }

  /**
   * Readable by anyone who can read the TICKET, with no extra permission.
   *
   * "Who is handling this and who had it before" is part of the ticket as far
   * as the person who raised it is concerned — the service applies the same
   * author-or-assignee filter it applies to the ticket itself, so this cannot
   * expose a history the caller could not already infer.
   */
  @Get(':id/assignments')
  listAssignments(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssignmentResponseDto[]> {
    return this.assignmentsGrpcClient.list(id, context);
  }

  // -------------------------------------------------------------------------

  @Delete(':id')
  @RequirePermission('ticket.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.ticketsGrpcClient.remove(id, context);
  }

  @Post(':id/restore')
  @RequirePermission('ticket.delete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket restored')
  restore(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.restore(id, context);
  }

  /**
   * The recycle bin is an ADMIN view.
   *
   * Refused rather than silently ignored: a client that asked for deleted rows
   * and got live ones would show an empty bin and conclude there was nothing to
   * restore.
   */
  private assertMayIncludeDeleted(
    context: RequestContext,
    query: ListTicketsQueryDto,
  ): void {
    if (!query.includeDeleted) return;
    if (context.isSuperAdmin) return;
    if (context.permissionCodes.includes('ticket.delete')) return;

    throw new ForbiddenException(
      'Viewing deleted tickets requires the ticket.delete permission',
    );
  }
}
