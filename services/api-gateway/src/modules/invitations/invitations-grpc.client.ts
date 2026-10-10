import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  INVITATION_SERVICE_NAME,
  InvitationServiceClient,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationsRequest,
  CreateInvitationsResponse,
  InvitationResponse,
  ListInvitationsRequest,
  ListInvitationsResponse,
  PreviewInvitationResponse,
  PreviewInvitationsRequest,
  PreviewInvitationsResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

@Injectable()
export class InvitationsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private invitationGrpcService!: InvitationServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.invitationGrpcService =
      this.client.getService<InvitationServiceClient>(INVITATION_SERVICE_NAME);
  }

  create(
    request: CreateInvitationsRequest,
    origin: RequestOrigin,
  ): Promise<CreateInvitationsResponse> {
    return this.call(
      (metadata) =>
        this.invitationGrpcService.createInvitations(request, metadata),
      origin,
    );
  }

  list(
    request: ListInvitationsRequest,
    context: RequestOrigin,
  ): Promise<ListInvitationsResponse> {
    return this.call(
      (metadata) =>
        this.invitationGrpcService.listInvitations(request, metadata),
      context,
    );
  }

  resend(
    organizationId: string,
    invitationId: string,
    actorId: string,
    origin: RequestOrigin,
  ): Promise<InvitationResponse> {
    return this.call(
      (metadata) =>
        this.invitationGrpcService.resendInvitation(
          { organizationId, invitationId, actorId },
          metadata,
        ),
      origin,
    );
  }

  async revoke(
    organizationId: string,
    invitationId: string,
    actorId: string,
    origin: RequestOrigin,
  ): Promise<void> {
    await this.call(
      (metadata) =>
        this.invitationGrpcService.revokeInvitation(
          { organizationId, invitationId, actorId },
          metadata,
        ),
      origin,
    );
  }

  previewByToken(
    token: string,
    origin: RequestOrigin,
  ): Promise<PreviewInvitationResponse> {
    return this.call(
      (metadata) =>
        this.invitationGrpcService.previewInvitation({ token }, metadata),
      origin,
    );
  }

  accept(
    request: AcceptInvitationRequest,
    origin: RequestOrigin,
  ): Promise<AcceptInvitationResponse> {
    return this.call(
      (metadata) =>
        this.invitationGrpcService.acceptInvitation(request, metadata),
      origin,
    );
  }

  previewBatch(
    request: PreviewInvitationsRequest,
    context: RequestContext,
  ): Promise<PreviewInvitationsResponse> {
    return this.call(
      (metadata) =>
        this.invitationGrpcService.previewInvitations(request, metadata),
      context,
    );
  }

  get(
    organizationId: string,
    invitationId: string,
    context: RequestContext,
  ): Promise<InvitationResponse> {
    return this.call(
      (metadata) =>
        this.invitationGrpcService.getInvitation(
          { organizationId, invitationId },
          metadata,
        ),
      context,
    );
  }
}
