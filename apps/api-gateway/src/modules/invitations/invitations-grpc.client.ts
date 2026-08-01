import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  fromTimestamp,
  INVITATION_SERVICE_NAME,
  InvitationServiceClient,
  toProtoInvitationStatus,
} from '@synapsedesk/grpc-proto';
import { RequestOrigin } from '@synapsedesk/common';
import { toInvitationDto } from './invitation.mapper';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { toUserResponseDto } from '../users/user.mapper';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import {
  AcceptInvitationDto,
  CreateInvitationsDto,
  CreateInvitationsResponseDto,
  InvitationResponseDto,
  ListInvitationsQueryDto,
  PreviewInvitationResponseDto,
} from './dto/rest/invitation.dto';

/** Accepting signs the invitee in, so the controller needs the raw tokens. */
export type AcceptInvitationResult = {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
  skipped: string[];
};

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

  async create(
    organizationId: string,
    invitedById: string,
    dto: CreateInvitationsDto,
    origin: RequestOrigin,
  ): Promise<CreateInvitationsResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.invitationGrpcService.createInvitations(
          {
            organizationId,
            invitedById,
            invitations: dto.invitations.map((invitation) => ({
              email: invitation.email,
              roleIds: invitation.roleIds ?? [],
              departmentIds: invitation.departmentIds ?? [],
              primaryDepartmentId: invitation.primaryDepartmentId,
            })),
          },
          metadata,
        ),
      origin,
    );

    return {
      created: response.created.map(toInvitationDto),
      failed: response.failed,
      batchId: response.batchId ?? null,
    };
  }

  async list(
    organizationId: string,
    query: ListInvitationsQueryDto,
    origin: RequestOrigin,
  ): Promise<{ items: InvitationResponseDto[]; totalItems: number }> {
    const response = await this.call(
      (metadata) =>
        this.invitationGrpcService.listInvitations(
          {
            organizationId,
            status: query.status
              ? toProtoInvitationStatus(query.status)
              : undefined,
            page: query.page,
            limit: query.limit,
            searchTerm: query.searchTerm,
          },
          metadata,
        ),
      origin,
    );

    return {
      items: response.items.map(toInvitationDto),
      totalItems: response.totalItems,
    };
  }

  async resend(
    organizationId: string,
    invitationId: string,
    actorId: string,
    origin: RequestOrigin,
  ): Promise<InvitationResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.invitationGrpcService.resendInvitation(
          { organizationId, invitationId, actorId },
          metadata,
        ),
      origin,
    );

    return toInvitationDto(response);
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

  async preview(
    token: string,
    origin: RequestOrigin,
  ): Promise<PreviewInvitationResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.invitationGrpcService.previewInvitation({ token }, metadata),
      origin,
    );

    return {
      valid: response.valid,
      organizationName: response.organizationName ?? null,
      inviterName: response.inviterName ?? null,
      email: response.email ?? null,
      roleNames: response.roleNames,
      expiresAt: fromTimestamp(response.expiresAt) ?? null,
    };
  }

  async accept(
    dto: AcceptInvitationDto,
    origin: RequestOrigin,
  ): Promise<AcceptInvitationResult> {
    const response = await this.call(
      (metadata) =>
        this.invitationGrpcService.acceptInvitation(
          {
            token: dto.token,
            fullName: dto.fullName,
            password: dto.password,
            deviceName: dto.deviceName,
          },
          metadata,
        ),
      origin,
    );

    return {
      user: toUserResponseDto(response.user!),
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      skipped: response.skipped,
    };
  }
}
