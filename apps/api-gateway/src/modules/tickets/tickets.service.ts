import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import {
  toProtoTicketPriority,
  toProtoTicketSource,
  toProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { TicketsGrpcClient } from './tickets-grpc.client';
import {
  toListTicketsRequest,
  toTicketPageDto,
  toTicketResponseDto,
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

/** The gateway's ticket surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class TicketsService {
  constructor(private readonly ticketsGrpcClient: TicketsGrpcClient) {}

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
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.escalate(id, context),
    );
  }

  async resolve(
    id: string,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.resolve(id, context),
    );
  }

  async reopen(
    id: string,
    context: RequestContext,
  ): Promise<TicketResponseDto> {
    return toTicketResponseDto(
      await this.ticketsGrpcClient.reopen(id, context),
    );
  }

  async close(id: string, context: RequestContext): Promise<TicketResponseDto> {
    return toTicketResponseDto(await this.ticketsGrpcClient.close(id, context));
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
}
