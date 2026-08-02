import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationsRequest,
  CreateInvitationsResponse,
  ExpireStaleInvitationsResponse,
  InvitationIdRequest,
  InvitationResponse,
  InvitationServiceController,
  InvitationServiceControllerMethods,
  ListInvitationsRequest,
  ListInvitationsResponse,
  PreviewInvitationRequest,
  PreviewInvitationResponse,
  RevokeInvitationResponse,
  GetInvitationRequest,
  PreviewInvitationsRequest,
  PreviewInvitationsResponse,
  unpackCallerContext,
  unpackRequestOrigin,
} from '@synapsedesk/grpc-proto';
import { InvitationsService } from './invitations.service';

@Controller()
@InvitationServiceControllerMethods()
export class InvitationsGrpcController implements InvitationServiceController {
  constructor(private readonly invitationsService: InvitationsService) {}

  createInvitations(
    request: CreateInvitationsRequest,
    metadata?: Metadata,
  ): Promise<CreateInvitationsResponse> {
    return this.invitationsService.createInvitations(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  listInvitations(
    request: ListInvitationsRequest,
  ): Promise<ListInvitationsResponse> {
    return this.invitationsService.listInvitations(request);
  }

  resendInvitation(
    request: InvitationIdRequest,
    metadata?: Metadata,
  ): Promise<InvitationResponse> {
    return this.invitationsService.resendInvitation(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  revokeInvitation(
    request: InvitationIdRequest,
  ): Promise<RevokeInvitationResponse> {
    return this.invitationsService.revokeInvitation(request);
  }

  previewInvitation(
    request: PreviewInvitationRequest,
  ): Promise<PreviewInvitationResponse> {
    return this.invitationsService.previewInvitation(request);
  }

  /** Creates a `device_sessions` row, so it needs the observed origin. */
  acceptInvitation(
    request: AcceptInvitationRequest,
    metadata?: Metadata,
  ): Promise<AcceptInvitationResponse> {
    return this.invitationsService.acceptInvitation(
      request,
      unpackRequestOrigin(metadata),
    );
  }

  expireStaleInvitations(): Promise<ExpireStaleInvitationsResponse> {
    return this.invitationsService.expireStaleInvitations();
  }
  /** Dry run: no writes, no mail. */
  previewInvitations(
    request: PreviewInvitationsRequest,
    metadata?: Metadata,
  ): Promise<PreviewInvitationsResponse> {
    return this.invitationsService.previewInvitations(
      request,
      unpackCallerContext(metadata),
    );
  }

  /** Administrative detail by id, as opposed to the public by-token preview. */
  getInvitation(request: GetInvitationRequest): Promise<InvitationResponse> {
    return this.invitationsService.getInvitation(request);
  }
}
