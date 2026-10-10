import { Injectable } from '@nestjs/common';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { InvitationsGrpcClient } from './invitations-grpc.client';
import {
  AcceptInvitationResult,
  toAcceptInvitationResult,
  toCreateInvitationsResponseDto,
  toInvitationPageDto,
  toListInvitationsRequest,
  toInvitationResponseDto,
  toInviteUserInput,
  toPreviewInvitationResponseDto,
  toPreviewInvitationsResponseDto,
} from './invitation.mapper';
import {
  AcceptInvitationDto,
  CreateInvitationsDto,
  ListInvitationsQueryDto,
  PreviewInvitationsDto,
} from './dto/rest/invitation.dto';
import {
  CreateInvitationsResponseDto,
  InvitationResponseDto,
  PreviewInvitationResponseDto,
  PreviewInvitationsResponseDto,
} from './dto/rest/invitation-response.dto';

/** The gateway's invitation surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class InvitationsService {
  constructor(private readonly invitationsGrpcClient: InvitationsGrpcClient) {}

  async create(
    organizationId: string,
    invitedById: string,
    dto: CreateInvitationsDto,
    origin: RequestOrigin,
  ): Promise<CreateInvitationsResponseDto> {
    return toCreateInvitationsResponseDto(
      await this.invitationsGrpcClient.create(
        {
          organizationId,
          invitedById,
          invitations: dto.invitations.map(toInviteUserInput),
        },
        origin,
      ),
    );
  }

  async list(
    organizationId: string,
    query: ListInvitationsQueryDto,
    origin: RequestOrigin,
  ): Promise<PaginationResponseDto<InvitationResponseDto>> {
    return toInvitationPageDto(
      await this.invitationsGrpcClient.list(
        toListInvitationsRequest(organizationId, query),
        origin,
      ),
    );
  }

  async resend(
    organizationId: string,
    invitationId: string,
    actorId: string,
    origin: RequestOrigin,
  ): Promise<InvitationResponseDto> {
    return toInvitationResponseDto(
      await this.invitationsGrpcClient.resend(
        organizationId,
        invitationId,
        actorId,
        origin,
      ),
    );
  }

  revoke(
    organizationId: string,
    invitationId: string,
    actorId: string,
    origin: RequestOrigin,
  ): Promise<void> {
    return this.invitationsGrpcClient.revoke(
      organizationId,
      invitationId,
      actorId,
      origin,
    );
  }

  async previewByToken(
    token: string,
    origin: RequestOrigin,
  ): Promise<PreviewInvitationResponseDto> {
    return toPreviewInvitationResponseDto(
      await this.invitationsGrpcClient.previewByToken(token, origin),
    );
  }

  async accept(
    dto: AcceptInvitationDto,
    origin: RequestOrigin,
  ): Promise<AcceptInvitationResult> {
    return toAcceptInvitationResult(
      await this.invitationsGrpcClient.accept(
        {
          token: dto.token,
          fullName: dto.fullName,
          password: dto.password,
          deviceName: dto.deviceName,
        },
        origin,
      ),
    );
  }

  async previewBatch(
    organizationId: string,
    dto: PreviewInvitationsDto,
    context: RequestContext,
  ): Promise<PreviewInvitationsResponseDto> {
    return toPreviewInvitationsResponseDto(
      await this.invitationsGrpcClient.previewBatch(
        {
          organizationId,
          invitations: dto.invitations.map(toInviteUserInput),
        },
        context,
      ),
    );
  }

  async get(
    organizationId: string,
    invitationId: string,
    context: RequestContext,
  ): Promise<InvitationResponseDto> {
    return toInvitationResponseDto(
      await this.invitationsGrpcClient.get(
        organizationId,
        invitationId,
        context,
      ),
    );
  }
}
