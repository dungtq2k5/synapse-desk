import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  fromTimestamp,
  INVITATION_SERVICE_NAME,
  InvitationServiceClient,
  toPageRequest,
  toProtoInvitationStatus,
} from '@synapsedesk/grpc-proto';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { toInvitationDto } from './invitation.mapper';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { toPaginationMeta } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto } from '../users/user.mapper';
import { UserResponseDto } from '../users/dto/rest/user-response.dto';
import {
  AcceptInvitationDto,
  CreateInvitationsDto,
  CreateInvitationsResponseDto,
  InvitationResponseDto,
  ListInvitationsQueryDto,
  PreviewInvitationResponseDto,
  PreviewInvitationsDto,
  PreviewInvitationsResponseDto,
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
  ): Promise<PaginationResponseBase<InvitationResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.invitationGrpcService.listInvitations(
          {
            organizationId,
            status: query.status
              ? toProtoInvitationStatus(query.status)
              : undefined,
            page: toPageRequest(query),
          },
          metadata,
        ),
      origin,
    );

    return {
      items: response.items.map(toInvitationDto),
      meta: toPaginationMeta(response.meta),
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

  async previewByToken(
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
  async previewBatch(
    organizationId: string,
    dto: PreviewInvitationsDto,
    context: RequestContext,
  ): Promise<PreviewInvitationsResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.invitationGrpcService.previewInvitations(
          {
            organizationId,
            invitations: dto.invitations.map((invitation) => ({
              email: invitation.email,
              roleIds: invitation.roleIds ?? [],
              departmentIds: invitation.departmentIds ?? [],
              primaryDepartmentId: invitation.primaryDepartmentId,
            })),
          },
          metadata,
        ),
      context,
    );

    return {
      rows: response.rows.map((row) => ({
        email: row.email,
        ok: row.ok,
        reason: row.reason ?? null,
        unknownRoleIds: row.unknownRoleIds,
        unknownDepartmentIds: row.unknownDepartmentIds,
      })),
      seatsInUse: response.seatsInUse,
      maxAgentSeats: response.maxAgentSeats,
      seatOverrun: response.seatOverrun,
    };
  }

  async get(
    organizationId: string,
    invitationId: string,
    context: RequestContext,
  ): Promise<InvitationResponseDto> {
    return toInvitationDto(
      await this.call(
        (metadata) =>
          this.invitationGrpcService.getInvitation(
            { organizationId, invitationId },
            metadata,
          ),
        context,
      ),
    );
  }
}
