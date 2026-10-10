import { Injectable } from '@nestjs/common';
import { ExportKind, RequestContext } from '@synapsedesk/common';
import {
  toProtoTicketPriority,
  toProtoTicketSource,
  toProtoTicketStatus,
  fromProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { TicketsGrpcClient } from './tickets-grpc.client';
import {
  toListTicketsRequest,
  toTicketPageDto,
  toTicketResponseDto,
  toTicketStatusChangeResponseDto,
} from './ticket.mapper';
import {
  BulkTicketPriorityDto,
  MarkTicketReadDto,
  TicketStatusActionDto,
  BulkTicketStatusDto,
  ChangeTicketStatusDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  UpdateTicketDto,
  CreateTicketExportDto,
} from './dto/rest/ticket.dto';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExportResponseDto } from '../analytics/dto/rest/analytics-response.dto';
import {
  BulkTicketPriorityResponseDto,
  MarkTicketReadResponseDto,
  TicketStatusChangeResponseDto,
  BulkTicketStatusResponseDto,
  TicketResponseDto,
} from './dto/rest/ticket-response.dto';

/** The gateway's ticket surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class TicketsService {
  constructor(
    private readonly ticketsGrpcClient: TicketsGrpcClient,
    // The export lifecycle is shared with analytics and audit logs — one table,
    // one queue, one processor. This module owns the ROUTE.
    private readonly analytics: AnalyticsService,
  ) {}

  async list(
    query: ListTicketsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<TicketResponseDto>> {
    return toTicketPageDto(
      await this.ticketsGrpcClient.list(toListTicketsRequest(query), context),
    );
  }

  async get(id: string, context: RequestContext): Promise<TicketResponseDto> {
    return toTicketResponseDto(await this.ticketsGrpcClient.get(id, context));
  }

  async getByNumber(
    ticketNumber: number,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.getByNumber(ticketNumber, context),
    );
  }

  async create(
    dto: CreateTicketDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.create(
        {
          title: dto.title,
          description: dto.description,
          priority: toProtoTicketPriority(dto.priority),
          source: toProtoTicketSource(dto.source),
          authorId: dto.authorId,
        },
        context,
      ),
    );
  }

  async update(
    id: string,
    dto: UpdateTicketDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.update(
        {
          id,
          title: dto.title,
          description: dto.description,
          priority: toProtoTicketPriority(dto.priority),
        },
        context,
      ),
    );
  }

  async changeStatus(
    id: string,
    dto: ChangeTicketStatusDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.changeStatus(
        { id, status: toProtoTicketStatus(dto.status), reason: dto.reason },
        context,
      ),
    );
  }

  async escalate(
    id: string,
    dto: TicketStatusActionDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.escalate(id, dto.reason, context),
    );
  }

  async resolve(
    id: string,
    dto: TicketStatusActionDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.resolve(id, dto.reason, context),
    );
  }

  async reopen(
    id: string,
    dto: TicketStatusActionDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.reopen(id, dto.reason, context),
    );
  }

  async close(
    id: string,
    dto: TicketStatusActionDto,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.close(id, dto.reason, context),
    );
  }

  /**
   * Marks the thread read up to the newest message the client rendered.
   *
   * @returns what was actually stored — clamped to the server's clock, so a
   *   client with a fast one can see that it was.
   */
  async markRead(
    id: string,
    dto: MarkTicketReadDto,
    context: RequestContext,
  ): Promise<MarkTicketReadResponseDto> {
    const { lastReadAt } = await this.ticketsGrpcClient.markRead(
      id,
      dto.readAt,
      context,
    );

    return { lastReadAt: fromProtoTimestamp(lastReadAt)! };
  }

  async listStatusChanges(
    id: string,
    context: RequestContext,
  ): Promise<TicketStatusChangeResponseDto[]> {
    const { items } = await this.ticketsGrpcClient.listStatusChanges(
      id,
      context,
    );

    return items.map(toTicketStatusChangeResponseDto);
  }

  bulkChangeStatus(
    dto: BulkTicketStatusDto,
    context: RequestContext,
  ): Promise<BulkTicketStatusResponseDto> {
    return this.ticketsGrpcClient.bulkChangeStatus(
      {
        ticketIds: dto.ticketIds,
        status: toProtoTicketStatus(dto.status),
        reason: dto.reason,
      },
      context,
    );
  }

  bulkChangePriority(
    dto: BulkTicketPriorityDto,
    context: RequestContext,
  ): Promise<BulkTicketPriorityResponseDto> {
    return this.ticketsGrpcClient.bulkChangePriority(
      {
        ticketIds: dto.ticketIds,
        priority: toProtoTicketPriority(dto.priority),
      },
      context,
    );
  }

  remove(id: string, context: RequestContext): Promise<void> {
    return this.ticketsGrpcClient.remove(id, context);
  }

  async restore(
    id: string,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.restore(id, context),
    );
  }

  /**
   * Requests a ticket export through the shared export lifecycle.
   *
   * The visibility the file honours is resolved in ticket-service from the
   * caller context this request carries — not here, and not later in the
   * worker, which has no caller at all.
   */
  async createExport(
    dto: CreateTicketExportDto,
    context: RequestContext,
  ): Promise<ExportResponseDto> {
    return this.analytics.createExport(
      {
        kind: ExportKind.TICKET,
        from: dto.from,
        to: dto.to,
        departmentId: dto.departmentId,
        filters: dto.filters,
      },
      context,
    );
  }

  async getExport(
    id: string,
    context: RequestContext,
  ): Promise<ExportResponseDto> {
    return this.analytics.getExport(id, context);
  }
}
