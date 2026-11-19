import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  INGESTION_GRPC_CLIENT,
} from '@synapsedesk/grpc-proto';
import type { RequestContext } from '@synapsedesk/contracts';
import { CacheService } from '../../common/cache/cache.service';
import { createLoadersFor } from '../../common/graphql/loaders/loaders.factory';
import type {
  DepartmentReferenceResponseDto,
  UserReferenceResponseDto,
} from '../../common/dto/rest/reference-response.dto';
import type { TicketResponseDto } from './dto/rest/ticket-response.dto';
import type { MessageResponseDto } from './dto/rest/message-response.dto';

/**
 * Fills the names a REST ticket or message response shows: a ticket's
 * `author`, `assignee` and `department`, a message's `sender`. Every REST route
 * returning these DTOs calls it.
 *
 * **One lookup of each kind per response.** The distinct ids go through the
 * request's user and department loaders, which batch them into one
 * `ListUsersByIds` (summary projection, inactive users included, the caller's
 * tenant) and one `ListDepartmentsByIds`, with the entity cache in front.
 *
 * **Degrade, never fail.** A failed lookup, or an id that names nobody, leaves
 * the field `null` and the response still succeeds. An AI message's `sender` is
 * `null`: no user wrote it.
 *
 * @example await references.fillTickets(context, page.items)
 */
@Injectable()
export class TicketReferences {
  private readonly logger = new Logger(TicketReferences.name);

  constructor(
    @Inject(AUTH_GRPC_CLIENT) private readonly auth: ClientGrpc,
    @Inject(INGESTION_GRPC_CLIENT) private readonly ingestion: ClientGrpc,
    private readonly cache: CacheService,
  ) {}

  /** Names `author`, `assignee` and `department` on every ticket. */
  async fillTickets<T extends TicketResponseDto>(
    context: RequestContext,
    tickets: T[],
  ): Promise<T[]> {
    const { users, departments } = this.loaders(context);
    const [people, teams] = await Promise.all([
      this.users(
        users,
        tickets.flatMap((ticket) => [
          ticket.authorId,
          ticket.currentAssigneeId,
        ]),
      ),
      this.departments(
        departments,
        tickets.map((ticket) => ticket.currentDepartmentId),
      ),
    ]);

    for (const ticket of tickets) {
      ticket.author = people.get(ticket.authorId) ?? null;
      ticket.assignee = lookup(people, ticket.currentAssigneeId);
      ticket.department = lookup(teams, ticket.currentDepartmentId);
    }
    return tickets;
  }

  /** One ticket, named. */
  async fillTicket<T extends TicketResponseDto>(
    context: RequestContext,
    ticket: T,
  ): Promise<T> {
    await this.fillTickets(context, [ticket]);
    return ticket;
  }

  /** A page of tickets, named. */
  async fillTicketPage<P extends { items: TicketResponseDto[] }>(
    context: RequestContext,
    page: P,
  ): Promise<P> {
    await this.fillTickets(context, page.items);
    return page;
  }

  /** One message, named. */
  async fillMessage<T extends MessageResponseDto>(
    context: RequestContext,
    message: T,
  ): Promise<T> {
    await this.fillMessages(context, [message]);
    return message;
  }

  /** A page of messages, named. */
  async fillMessagePage<P extends { items: MessageResponseDto[] }>(
    context: RequestContext,
    page: P,
  ): Promise<P> {
    await this.fillMessages(context, page.items);
    return page;
  }

  /** Names `sender` on every message; `null` for an AI message. */
  async fillMessages<T extends MessageResponseDto>(
    context: RequestContext,
    messages: T[],
  ): Promise<T[]> {
    const people = await this.users(
      this.loaders(context).users,
      messages
        .filter((message) => !message.isAiGenerated)
        .map((message) => message.senderId),
    );

    for (const message of messages) {
      message.sender = message.isAiGenerated
        ? null
        : lookup(people, message.senderId);
    }
    return messages;
  }

  private loaders(context: RequestContext) {
    return createLoadersFor(() => context, {
      auth: this.auth,
      ingestion: this.ingestion,
      cache: this.cache,
    });
  }

  private async users(
    loader: ReturnType<TicketReferences['loaders']>['users'],
    ids: (string | null)[],
  ): Promise<Map<string, UserReferenceResponseDto>> {
    const found = await this.resolve(loader, ids, 'User');
    return new Map(
      found.map((user) => [
        user.id,
        { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl },
      ]),
    );
  }

  private async departments(
    loader: ReturnType<TicketReferences['loaders']>['departments'],
    ids: (string | null)[],
  ): Promise<Map<string, DepartmentReferenceResponseDto>> {
    const found = await this.resolve(loader, ids, 'Department');
    return new Map(
      found.map((team) => [team.id, { id: team.id, name: team.name }]),
    );
  }

  /**
   * The distinct ids, loaded in one batch. A failed lookup is logged and
   * answers nothing, so every field it would have named stays `null`.
   */
  private async resolve<V>(
    loader: { loadMany(ids: readonly string[]): Promise<(V | Error | null)[]> },
    ids: (string | null)[],
    kind: string,
  ): Promise<V[]> {
    const distinct = [...new Set(ids.filter((id): id is string => !!id))];
    if (distinct.length === 0) return [];

    const results = await loader.loadMany(distinct);
    const failure = results.find((result) => result instanceof Error);
    if (failure) {
      this.logger.warn(
        `${kind} names unavailable; answering without them: ${failure.message}`,
      );
    }
    return results.filter(
      (result): result is V => result !== null && !(result instanceof Error),
    );
  }
}

function lookup<V>(byId: Map<string, V>, id: string | null): V | null {
  return id ? (byId.get(id) ?? null) : null;
}
