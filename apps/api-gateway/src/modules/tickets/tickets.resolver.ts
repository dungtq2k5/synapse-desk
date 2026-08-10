import {
  Args,
  Context,
  ID,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { RequestContext, TicketStatus } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TicketsGrpcClient } from './tickets-grpc.client';
import { AssignmentsGrpcClient } from './assignments-grpc.client';
import { MessagesGrpcClient } from './messages-grpc.client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TicketMessageResponseGqlDto } from './dto/graphql/message-response.gql-dto';
import { TicketMutationPayloadGqlDto } from './dto/graphql/ticket-payload.gql-dto';
import { MAX_PAGE_SIZE } from '../../common/config/graphql-limits.config';
import { TicketResponseGqlDto } from './dto/graphql/ticket-response.gql-dto';
import { TicketPageGqlDto } from './dto/graphql/ticket-page.gql-dto';
import { TicketsArgsGqlDto } from './dto/graphql/tickets-args.gql-dto';
import { UserSummaryGqlDto } from '../users/dto/graphql/user-summary.gql-dto';
import { DepartmentResponseGqlDto } from '../departments/dto/graphql/department-response.gql-dto';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { toUserSummaryGqlDto } from '../users/user.mapper';
import { toDepartmentResponseGqlDto } from '../departments/department.mapper';

/**
 * `Query.ticket` and `Query.tickets` — 26-doc §4.
 *
 * **A resolver is a transport, not an implementation.** The same rule as
 * `message:send` (22-doc §2.1): it calls the same gRPC client the controller
 * calls, with a context built from the request, and does nothing else. A
 * GraphQL-only copy of a rule is a rule with two implementations, and the second
 * one is the one nobody updates.
 *
 * **The guards are the CONTROLLER'S guards, not equivalents.** `JwtAuthGuard`
 * and `PermissionGuard` are the same classes `TicketsController` applies, in the
 * same order. That is the property worth having — not that each transport is
 * guarded, but that they are guarded by the same code, so a change to the rule
 * cannot reach one and miss the other.
 *
 * **No `includeDeleted`.** The REST route accepts it and gates it on
 * `ticket.delete` inside the handler; reproducing that check here would be the
 * second implementation this class exists to avoid, so the argument is simply
 * not offered — see {@link TicketsArgsGqlDto}.
 */
@Resolver(() => TicketResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class TicketsResolver {
  // Named `client`, not `tickets`: the query below is also called `tickets`,
  // and a field and a method of the same name on one class is a duplicate
  // identifier rather than a shadowing warning.
  constructor(
    private readonly client: TicketsGrpcClient,
    private readonly assignments: AssignmentsGrpcClient,
    private readonly messagesClient: MessagesGrpcClient,
  ) {}

  /**
   * One ticket, or `null`.
   *
   * **`nullable: true` is deliberate** — 26-doc §4. REST returns 404; GraphQL's
   * idiom is `null` plus an error entry where it matters. A non-null field that
   * throws takes its parent's whole `data` with it, so one missing ticket would
   * null an entire dashboard rather than one card on it.
   *
   * A cross-tenant id is also `null` rather than an error, and that is the same
   * decision the REST route makes for the same reason: distinguishing "not
   * found" from "not yours" turns a by-id query into an existence oracle.
   */
  @Query(() => TicketResponseGqlDto, {
    nullable: true,
    description:
      'A single ticket by id. Null when it does not exist, or belongs to ' +
      'another tenant, or is not visible to this caller — the three are ' +
      'deliberately indistinguishable.',
  })
  async ticket(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<TicketResponseGqlDto | null> {
    try {
      return await this.client.get(id, context);
    } catch {
      // The gRPC NOT_FOUND that the REST route turns into a 404. Swallowed to
      // `null` here rather than rethrown, because a thrown error on a non-null
      // field would take the rest of the query's data with it.
      return null;
    }
  }

  /**
   * A page of tickets.
   *
   * Narrowed by ticket-service to what the caller authored or is assigned,
   * unless they hold `ticket.read.all` — the same visibility filter the REST
   * list applies, because it is the same call.
   */
  @Query(() => TicketPageGqlDto, {
    description:
      'A page of tickets visible to the caller. `first` is clamped to ' +
      `${MAX_PAGE_SIZE}; asking for more returns that many rather than an error.`,
  })
  async tickets(
    @Args() args: TicketsArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<TicketPageGqlDto> {
    const page = await this.client.list(
      {
        page: args.page,
        // **Clamped, not rejected** — 25-doc §5. An unbounded list multiplies
        // every nested field beneath it; refusing the request instead would
        // make the cap a breaking change for a client that worked yesterday.
        limit: Math.min(args.first, MAX_PAGE_SIZE),
        sortBy: args.sortBy ?? 'createdAt',
        sortOrder: 'DESC',
        status: args.status,
        priority: args.priority,
        source: args.source,
        assigneeId: args.assigneeId,
        departmentId: args.departmentId,
        authorId: args.authorId,
        includeDeleted: false,
      },
      context,
    );

    return page;
  }

  // ------------------------------------------------------------- edges

  /**
   * `Ticket.assignee` — **the feature this whole design exists for.**
   *
   * Four rules, each with a failure mode that only appears under load:
   *
   *   1. **Never a gRPC client, only a loader.** A direct call here is an N+1
   *      that works perfectly in every test with one parent row and becomes 50
   *      concurrent calls into auth-service on a real page.
   *   2. **The loader comes from the CONTEXT**, never injected — 25-doc §6.
   *      Injection means either a cache shared across tenants or request scope
   *      bubbling through the module graph.
   *   3. **Return `null` for an absent edge; do not load `undefined`.**
   *      DataLoader will happily batch a key of `undefined` and cache the
   *      failure, so an unassigned ticket would poison the batch for every
   *      other row on the page.
   *   4. **Re-check nothing the edge already justified, and expose nothing it
   *      does not** — which is `UserSummaryGqlDto` doing the work structurally so
   *      this method does not have to do it procedurally.
   */
  @ResolveField(() => UserSummaryGqlDto, {
    nullable: true,
    description:
      'The agent this ticket is assigned to. Null when unassigned, or when ' +
      'the user could not be resolved — one unreachable peer costs this ' +
      'field, not the response.',
  })
  async assignee(
    @Parent() ticket: TicketResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<UserSummaryGqlDto | null> {
    // Rule 3, and rule 1 of 26-doc §3's flat-field decision: a client asking
    // for `assignee { id }` is asking for something already on the parent, but
    // it asked through the edge — so this still loads. `currentAssigneeId` is
    // the field that costs nothing, and it is exposed for exactly that reason.
    if (!ticket.currentAssigneeId) return null;

    return toUserSummaryGqlDto(
      await loaders.users.load(ticket.currentAssigneeId),
    );
  }

  /** `Ticket.author` — the requester. Same loader, same batch. */
  @ResolveField(() => UserSummaryGqlDto, {
    nullable: true,
    description: 'Who raised the ticket.',
  })
  async author(
    @Parent() ticket: TicketResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<UserSummaryGqlDto | null> {
    if (!ticket.authorId) return null;

    // The SAME loader instance as `assignee`, which is most of the win: a page
    // where an agent authored ten tickets and is assigned five others fetches
    // them once, not fifteen times.
    return toUserSummaryGqlDto(await loaders.users.load(ticket.authorId));
  }

  @ResolveField(() => DepartmentResponseGqlDto, {
    nullable: true,
    description: 'The department currently handling this ticket.',
  })
  async department(
    @Parent() ticket: TicketResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<DepartmentResponseGqlDto | null> {
    if (!ticket.currentDepartmentId) return null;

    return toDepartmentResponseGqlDto(
      await loaders.departments.load(ticket.currentDepartmentId),
    );
  }

  /**
   * `Ticket.messages` — the thread.
   *
   * **No loader, deliberately** — 26-doc §3. The messages live in the SAME
   * service as the ticket and are fetched by ticket id, so this is one call per
   * ticket rather than a batch across tickets: there is no `ListMessagesByIds`
   * to batch into, and inventing one would batch a query nobody makes.
   *
   * That makes it the one field on this type where asking for it across a large
   * page IS N calls — which is exactly why the complexity scorer weights it and
   * why `first` is clamped above it.
   *
   * **`isInternalNote` is filtered by ticket-service**, not here. Third
   * transport, one rule (22-doc §1).
   */
  @ResolveField(() => [TicketMessageResponseGqlDto], {
    description:
      'The ticket thread, oldest first. Internal notes are filtered by ' +
      'ticket-service for callers without agent access — the same rule the ' +
      'REST list and the WebSocket fan-out apply.',
  })
  async messages(
    @Parent() ticket: TicketResponseGqlDto,
    @CurrentUser() context: RequestContext,
    @Args('first', { type: () => Int, defaultValue: 50 }) first: number,
  ): Promise<TicketMessageResponseGqlDto[]> {
    const page = await this.messagesClient.list(
      ticket.id,
      {
        page: 1,
        limit: Math.min(first, MAX_PAGE_SIZE),
        sortBy: 'createdAt',
        sortOrder: 'ASC',
      },
      context,
    );

    return page.items;
  }

  // ---------------------------------------------------------- mutations

  /**
   * **Four mutations, chosen rather than transcribed** — 25-doc §7.
   *
   * A mutation gains nothing from GraphQL except sharing a request with a
   * query, so the rule is: add one when a SCREEN wants it beside its reads.
   * These four are what a ticket detail view does — assign, escalate, change
   * status — and each returns the updated ticket so the view re-renders from
   * the response rather than re-querying.
   *
   * Everything else stays REST. Auth, uploads and AI streaming are explicitly
   * out (25-doc §7), and "REST and GraphQL both exist" is a permanent state
   * rather than a migration.
   */
  @Mutation(() => TicketMutationPayloadGqlDto, {
    description: 'Assigns the ticket to an agent.',
  })
  @RequirePermission('ticket.assign')
  async assignTicket(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @Args('assigneeId', { type: () => ID }, ParseUUIDPipe) assigneeId: string,
    // **Required, not inferred** — the same rule `AssignTicketDto` states.
    // Defaulting it to the assignee's primary department would put the ticket
    // wherever that agent happens to sit, which is wrong the moment somebody
    // belongs to two teams. A resolver inventing a default here would be a
    // second implementation of a rule the DTO deliberately refuses to guess.
    @Args('departmentId', { type: () => ID }, ParseUUIDPipe)
    departmentId: string,
    @CurrentUser() context: RequestContext,
  ): Promise<TicketMutationPayloadGqlDto> {
    await this.assignments.assign(id, { assigneeId, departmentId }, context);

    // The TICKET, not the assignment row: the screen renders a ticket, and the
    // assignment is an audit artefact it has no field for.
    return {
      ticket: await this.client.get(id, context),
      message: 'Ticket assigned',
    };
  }

  @Mutation(() => TicketMutationPayloadGqlDto, {
    description:
      'Hands the ticket to a human agent. Runs the same transition table, ' +
      'side effects and summary as `POST /tickets/:id/escalate`.',
  })
  async escalateTicket(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<TicketMutationPayloadGqlDto> {
    // No `@RequirePermission`, matching the REST route: escalating is what an
    // end user does when self-service has not helped, and requiring a grant
    // would make the handoff unreachable for exactly the person who needs it.
    return {
      ticket: await this.client.escalate(id, context),
      message: 'Handed off to an agent',
    };
  }

  @Mutation(() => TicketMutationPayloadGqlDto, {
    description:
      'Moves the ticket to a new status. The transition table is ' +
      "ticket-service's; an illegal move is an error, not a silent no-op.",
  })
  @RequirePermission('ticket.update')
  async transitionTicketStatus(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @Args('status', { type: () => TicketStatus }) status: TicketStatus,
    @Args('reason', { type: () => String, nullable: true })
    reason: string | undefined,
    @CurrentUser() context: RequestContext,
  ): Promise<TicketMutationPayloadGqlDto> {
    const ticket = await this.client.changeStatus(
      id,
      { status, reason },
      context,
    );

    return { ticket: ticket, message: `Status set to ${status}` };
  }
}
