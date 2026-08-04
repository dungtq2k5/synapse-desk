import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AssignmentResponse,
  AssignmentServiceController,
  AssignmentServiceControllerMethods,
  AssignTicketRequest,
  AssignTicketToSelfRequest,
  ListAssignmentsRequest,
  ListAssignmentsResponse,
  UnassignTicketRequest,
  UnassignTicketResponse,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { AssignmentsService } from './assignments.service';

@Controller()
@AssignmentServiceControllerMethods()
export class AssignmentsGrpcController implements AssignmentServiceController {
  constructor(private readonly assignments: AssignmentsService) {}

  assignTicket(
    request: AssignTicketRequest,
    metadata?: Metadata,
  ): Promise<AssignmentResponse> {
    return this.assignments.assignTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  /**
   * Deliberately the same service method as `assignTicket`.
   *
   * The proto keeps both names because "assign" and "reassign" are how the
   * business talks about it, but whether a write IS a reassignment is a fact
   * about the ticket's current state, not about which name the caller typed —
   * so the distinction is drawn once, in the service, from the data.
   */
  reassignTicket(
    request: AssignTicketRequest,
    metadata?: Metadata,
  ): Promise<AssignmentResponse> {
    return this.assignments.assignTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  assignTicketToSelf(
    request: AssignTicketToSelfRequest,
    metadata?: Metadata,
  ): Promise<AssignmentResponse> {
    return this.assignments.assignTicketToSelf(
      request,
      unpackCallerContext(metadata),
    );
  }

  unassignTicket(
    request: UnassignTicketRequest,
    metadata?: Metadata,
  ): Promise<UnassignTicketResponse> {
    return this.assignments.unassignTicket(
      request,
      unpackCallerContext(metadata),
    );
  }

  listAssignments(
    request: ListAssignmentsRequest,
    metadata?: Metadata,
  ): Promise<ListAssignmentsResponse> {
    return this.assignments.listAssignments(
      request,
      unpackCallerContext(metadata),
    );
  }
}
