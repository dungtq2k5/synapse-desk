import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  ASSIGNMENT_SERVICE_NAME,
  AssignmentServiceClient,
  TICKET_GRPC_CLIENT,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { toAssignmentDto, toProtoReason } from './assignment.mapper';
import { AssignmentResponseDto } from './dto/rest/assignment-response.dto';
import {
  AssignTicketDto,
  AssignTicketToSelfDto,
} from './dto/rest/assignment.dto';

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

  async assign(
    ticketId: string,
    dto: AssignTicketDto,
    context: RequestContext,
  ): Promise<AssignmentResponseDto> {
    return toAssignmentDto(
      await this.call(
        (metadata) =>
          this.assignmentGrpcService.assignTicket(
            {
              ticketId,
              assigneeId: dto.assigneeId,
              departmentId: dto.departmentId,
              reason: toProtoReason(dto.reason),
            },
            metadata,
          ),
        context,
      ),
    );
  }

  /**
   * Routed to the proto's `ReassignTicket`, which ticket-service implements
   * with the same service method as `AssignTicket` — the distinction is a
   * PERMISSION one at the gateway, not a behavioural one in the service.
   */
  async reassign(
    ticketId: string,
    dto: AssignTicketDto,
    context: RequestContext,
  ): Promise<AssignmentResponseDto> {
    return toAssignmentDto(
      await this.call(
        (metadata) =>
          this.assignmentGrpcService.reassignTicket(
            {
              ticketId,
              assigneeId: dto.assigneeId,
              departmentId: dto.departmentId,
              reason: toProtoReason(dto.reason),
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async assignToSelf(
    ticketId: string,
    dto: AssignTicketToSelfDto,
    context: RequestContext,
  ): Promise<AssignmentResponseDto> {
    return toAssignmentDto(
      await this.call(
        (metadata) =>
          this.assignmentGrpcService.assignTicketToSelf(
            { ticketId, departmentId: dto.departmentId },
            metadata,
          ),
        context,
      ),
    );
  }

  async unassign(ticketId: string, context: RequestContext): Promise<void> {
    await this.call(
      (metadata) =>
        this.assignmentGrpcService.unassignTicket({ ticketId }, metadata),
      context,
    );
  }

  async list(
    ticketId: string,
    context: RequestContext,
  ): Promise<AssignmentResponseDto[]> {
    const response = await this.call(
      (metadata) =>
        this.assignmentGrpcService.listAssignments({ ticketId }, metadata),
      context,
    );

    return response.items.map(toAssignmentDto);
  }
}
