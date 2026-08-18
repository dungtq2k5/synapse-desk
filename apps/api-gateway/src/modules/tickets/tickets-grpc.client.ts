import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  BulkTicketStatusRequest,
  BulkTicketStatusResponse,
  ChangeTicketStatusRequest,
  CreateTicketRequest,
  ListTicketsRequest,
  ListTicketsResponse,
  TICKET_GRPC_CLIENT,
  TICKET_SERVICE_NAME,
  TicketResponse,
  TicketServiceClient,
  UpdateTicketRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * The gateway's client for ticket-service.
 *
 * Every method takes the full `RequestContext`, never a bare `RequestOrigin`:
 * ticket-service's visibility filter reads `sub` and `permissionCodes` off the
 * metadata, and narrowing the parameter would strip them — which returns an
 * empty list rather than an error.
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

  list(
    request: ListTicketsRequest,
    context: RequestContext,
  ): Promise<ListTicketsResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.listTickets(request, metadata),
      context,
    );
  }

  get(id: string, context: RequestContext): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.getTicket({ id }, metadata),
      context,
    );
  }

  getByNumber(
    ticketNumber: number,
    context: RequestContext,
  ): Promise<TicketResponse> {
    return this.call(
      (metadata) =>
        this.ticketGrpcService.getTicketByNumber({ ticketNumber }, metadata),
      context,
    );
  }

  create(
    request: CreateTicketRequest,
    context: RequestContext,
  ): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.createTicket(request, metadata),
      context,
    );
  }

  update(
    request: UpdateTicketRequest,
    context: RequestContext,
  ): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.updateTicket(request, metadata),
      context,
    );
  }

  changeStatus(
    request: ChangeTicketStatusRequest,
    context: RequestContext,
  ): Promise<TicketResponse> {
    return this.call(
      (metadata) =>
        this.ticketGrpcService.changeTicketStatus(request, metadata),
      context,
    );
  }

  /**
   * The four convenience routes.
   *
   * Distinct RPCs rather than one with a status argument, so the gateway can
   * permission them separately — escalating and closing are different rights —
   * while the SERVICE routes all four through one transition validator.
   */
  escalate(id: string, context: RequestContext): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.escalateTicket({ id }, metadata),
      context,
    );
  }

  resolve(id: string, context: RequestContext): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.resolveTicket({ id }, metadata),
      context,
    );
  }

  reopen(id: string, context: RequestContext): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.reopenTicket({ id }, metadata),
      context,
    );
  }

  close(id: string, context: RequestContext): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.closeTicket({ id }, metadata),
      context,
    );
  }

  bulkChangeStatus(
    request: BulkTicketStatusRequest,
    context: RequestContext,
  ): Promise<BulkTicketStatusResponse> {
    return this.call(
      (metadata) =>
        this.ticketGrpcService.bulkChangeTicketStatus(request, metadata),
      context,
    );
  }

  async remove(id: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) => this.ticketGrpcService.deleteTicket({ id }, metadata),
      context,
    );
  }

  restore(id: string, context: RequestContext): Promise<TicketResponse> {
    return this.call(
      (metadata) => this.ticketGrpcService.restoreTicket({ id }, metadata),
      context,
    );
  }
}
