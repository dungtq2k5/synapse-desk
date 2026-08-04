import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  BulkTicketStatusRequest,
  BulkTicketStatusResponse,
  ChangeTicketStatusRequest,
  CreateTicketRequest,
  DeleteTicketResponse,
  GetTicketByNumberRequest,
  GetTicketRequest,
  ListTicketsRequest,
  ListTicketsResponse,
  TicketIdRequest,
  TicketResponse,
  TicketServiceController,
  TicketServiceControllerMethods,
  unpackCallerContext,
  UpdateTicketRequest,
} from '@synapsedesk/grpc-proto';
import { TicketsService } from './tickets.service';

/**
 * Every method unpacks the caller context, because every query is scoped by it
 * — the tenant filter AND the narrower author/assignee filter both read it.
 * Unpacking uniformly rather than only where a write needs an actor id is what
 * stops an RPC being added with an unscoped read.
 */
@Controller()
@TicketServiceControllerMethods()
export class TicketsGrpcController implements TicketServiceController {
  constructor(private readonly ticketsService: TicketsService) {}

  createTicket(
    request: CreateTicketRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.createTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  getTicket(
    request: GetTicketRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.getTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  getTicketByNumber(
    request: GetTicketByNumberRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.getTicketByNumber(
      request,
      unpackCallerContext(metadata),
    );
  }

  listTickets(
    request: ListTicketsRequest,
    metadata?: Metadata,
  ): Promise<ListTicketsResponse> {
    return this.ticketsService.listTickets(
      request,
      unpackCallerContext(metadata),
    );
  }

  updateTicket(
    request: UpdateTicketRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.updateTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  changeTicketStatus(
    request: ChangeTicketStatusRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.changeTicketStatus(
      request,
      unpackCallerContext(metadata),
    );
  }

  escalateTicket(
    request: TicketIdRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.escalateTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  resolveTicket(
    request: TicketIdRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.resolveTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  reopenTicket(
    request: TicketIdRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.reopenTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  closeTicket(
    request: TicketIdRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.closeTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  bulkChangeTicketStatus(
    request: BulkTicketStatusRequest,
    metadata?: Metadata,
  ): Promise<BulkTicketStatusResponse> {
    return this.ticketsService.bulkChangeTicketStatus(
      request,
      unpackCallerContext(metadata),
    );
  }

  deleteTicket(
    request: TicketIdRequest,
    metadata?: Metadata,
  ): Promise<DeleteTicketResponse> {
    return this.ticketsService.deleteTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  restoreTicket(
    request: TicketIdRequest,
    metadata?: Metadata,
  ): Promise<TicketResponse> {
    return this.ticketsService.restoreTicket(
      request,
      unpackCallerContext(metadata),
    );
  }
}
