import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  TICKET_GRPC_CLIENT,
  TICKET_SERVICE_NAME,
  TicketServiceClient,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { toPaginationMeta } from '../../common/mappers/pagination.mapper';
import {
  toProtoPriority,
  toProtoSource,
  toProtoStatus,
  toTicketDto,
} from './ticket.mapper';
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

/**
 * Every method takes the full `RequestContext`, not a bare origin.
 *
 * `BaseGrpcClient.call` packs it into metadata, which is how BOTH the tenant
 * and the caller's identity reach ticket-service — and the identity matters
 * more here than in Domain A, because the visibility filter (author-or-assignee
 * for a non-agent) reads `sub` and `permissionCodes` directly. Narrowing any of
 * these to `RequestOrigin` would strip that and the service would return an
 * empty list rather than an error, which is the worse failure.
 */
@Injectable()
export class TicketsGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'ticket-service';

  private ticketGrpcService!: TicketServiceClient;

  constructor(@Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.ticketGrpcService =
      this.client.getService<TicketServiceClient>(TICKET_SERVICE_NAME);
  }

  async list(
    query: ListTicketsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseBase<TicketResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.ticketGrpcService.listTickets(
          {
            page: toPageRequest(query),
            status: toProtoStatus(query.status),
            priority: toProtoPriority(query.priority),
            source: toProtoSource(query.source),
            // '' rather than undefined: proto3 scalars have no null, and the
            // service reads the empty string as "no filter".
            assigneeId: query.assigneeId ?? '',
            departmentId: query.departmentId ?? '',
            authorId: query.authorId ?? '',
            includeDeleted: query.includeDeleted,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toTicketDto),
      meta: toPaginationMeta(response.meta),
    };
  }

  async get(id: string, context: RequestContext): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) => this.ticketGrpcService.getTicket({ id }, metadata),
        context,
      ),
    );
  }

  async getByNumber(
    ticketNumber: number,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) =>
          this.ticketGrpcService.getTicketByNumber({ ticketNumber }, metadata),
        context,
      ),
    );
  }

  async create(
    dto: CreateTicketDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) =>
          this.ticketGrpcService.createTicket(
            {
              title: dto.title,
              description: dto.description,
              priority: toProtoPriority(dto.priority),
              source: toProtoSource(dto.source),
              authorId: dto.authorId,
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async update(
    id: string,
    dto: UpdateTicketDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) =>
          this.ticketGrpcService.updateTicket(
            {
              id,
              title: dto.title,
              description: dto.description,
              priority: toProtoPriority(dto.priority),
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async changeStatus(
    id: string,
    dto: ChangeTicketStatusDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) =>
          this.ticketGrpcService.changeTicketStatus(
            { id, status: toProtoStatus(dto.status), reason: dto.reason },
            metadata,
          ),
        context,
      ),
    );
  }

  /**
   * The four convenience routes.
   *
   * Distinct RPCs rather than one with a status argument, so the gateway can
   * permission them separately — escalating and closing are different rights —
   * while the SERVICE routes all four through one transition validator.
   */
  async escalate(
    id: string,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) => this.ticketGrpcService.escalateTicket({ id }, metadata),
        context,
      ),
    );
  }

  async resolve(
    id: string,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) => this.ticketGrpcService.resolveTicket({ id }, metadata),
        context,
      ),
    );
  }

  async reopen(
    id: string,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) => this.ticketGrpcService.reopenTicket({ id }, metadata),
        context,
      ),
    );
  }

  async close(id: string, context: RequestContext): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) => this.ticketGrpcService.closeTicket({ id }, metadata),
        context,
      ),
    );
  }

  async bulkChangeStatus(
    dto: BulkTicketStatusDto,
    context: RequestContext,
  ): Promise<BulkTicketStatusResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.ticketGrpcService.bulkChangeTicketStatus(
          {
            ticketIds: dto.ticketIds,
            status: toProtoStatus(dto.status),
            reason: dto.reason,
          },
          metadata,
        ),
      context,
    );

    return { updated: response.updated, failed: response.failed };
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) => this.ticketGrpcService.deleteTicket({ id }, metadata),
      context,
    );
  }

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketDto(
      await this.call(
        (metadata) => this.ticketGrpcService.restoreTicket({ id }, metadata),
        context,
      ),
    );
  }
}
