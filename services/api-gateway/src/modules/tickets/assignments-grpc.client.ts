import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  ASSIGNMENT_SERVICE_NAME,
  AssignmentServiceClient,
  TICKET_GRPC_CLIENT,
  AssignmentResponse,
  AssignTicketRequest,
  AssignTicketToSelfRequest,
  ListAssignmentsResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * Shares the single `TICKET_GRPC_CLIENT` channel with `TicketsGrpcClient` —
 * `getService` is a view onto that one connection, not a new one.
 */
@Injectable()
export class AssignmentsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'ticket-service';

  private assignmentGrpcService!: AssignmentServiceClient;

  constructor(@Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.assignmentGrpcService =
      this.client.getService<AssignmentServiceClient>(ASSIGNMENT_SERVICE_NAME);
  }

  assign(
    request: AssignTicketRequest,
    context: RequestContext,
  ): Promise<AssignmentResponse> {
    return this.call(
      (metadata) => this.assignmentGrpcService.assignTicket(request, metadata),
      context,
    );
  }

  /**
   * Routed to the proto's `ReassignTicket`, which ticket-service implements
   * with the same service method as `AssignTicket` — the distinction is a
   * PERMISSION one at the gateway, not a behavioural one in the service.
   */
  reassign(
    request: AssignTicketRequest,
    context: RequestContext,
  ): Promise<AssignmentResponse> {
    return this.call(
      (metadata) =>
        this.assignmentGrpcService.reassignTicket(request, metadata),
      context,
    );
  }

  assignToSelf(
    request: AssignTicketToSelfRequest,
    context: RequestContext,
  ): Promise<AssignmentResponse> {
    return this.call(
      (metadata) =>
        this.assignmentGrpcService.assignTicketToSelf(request, metadata),
      context,
    );
  }

  async unassign(ticketId: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) =>
        this.assignmentGrpcService.unassignTicket({ ticketId }, metadata),
      context,
    );
  }

  list(
    ticketId: string,
    context: RequestContext,
  ): Promise<ListAssignmentsResponse> {
    return this.call(
      (metadata) =>
        this.assignmentGrpcService.listAssignments({ ticketId }, metadata),
      context,
    );
  }
}
