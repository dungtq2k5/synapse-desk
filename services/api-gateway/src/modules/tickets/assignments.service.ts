import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { AssignmentsGrpcClient } from './assignments-grpc.client';
import {
  toAssignmentResponseDto,
  toAssignmentResponseDtos,
  toAssignTicketRequest,
} from './assignment.mapper';
import { AssignmentResponseDto } from './dto/rest/assignment-response.dto';
import {
  AssignTicketDto,
  AssignTicketToSelfDto,
} from './dto/rest/assignment.dto';

/** The gateway's assignment surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class AssignmentsService {
  constructor(private readonly assignmentsGrpcClient: AssignmentsGrpcClient) {}

  async assign(
    ticketId: string,
    dto: AssignTicketDto,
    context: RequestContext,
  ): Promise<AssignmentResponseDto> {
    return toAssignmentResponseDto(
      await this.assignmentsGrpcClient.assign(
        toAssignTicketRequest(ticketId, dto),
        context,
      ),
    );
  }

  /**
   * The same service method as {@link assign} — the two differ by the
   * permission the route requires, not by behaviour.
   */
  async reassign(
    ticketId: string,
    dto: AssignTicketDto,
    context: RequestContext,
  ): Promise<AssignmentResponseDto> {
    return toAssignmentResponseDto(
      await this.assignmentsGrpcClient.reassign(
        toAssignTicketRequest(ticketId, dto),
        context,
      ),
    );
  }

  async assignToSelf(
    ticketId: string,
    dto: AssignTicketToSelfDto,
    context: RequestContext,
  ): Promise<AssignmentResponseDto> {
    return toAssignmentResponseDto(
      await this.assignmentsGrpcClient.assignToSelf(
        { ticketId, departmentId: dto.departmentId },
        context,
      ),
    );
  }

  unassign(ticketId: string, context: RequestContext): Promise<void> {
    return this.assignmentsGrpcClient.unassign(ticketId, context);
  }

  async list(
    ticketId: string,
    context: RequestContext,
  ): Promise<AssignmentResponseDto[]> {
    return toAssignmentResponseDtos(
      await this.assignmentsGrpcClient.list(ticketId, context),
    );
  }
}
