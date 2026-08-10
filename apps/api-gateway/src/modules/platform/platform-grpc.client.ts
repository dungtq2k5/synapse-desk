import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  fromProtoTimestamp,
  PLATFORM_SERVICE_NAME,
  PlatformServiceClient,
  requireProtoTimestamp,
  toPageRequest,
  toProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto } from '../users/user.mapper';
import { toRoleResponseDto } from '../roles/role.mapper';
import {
  CreateGlobalRoleDto,
  CreatePlatformOrganizationDto,
  CreatePlatformOrganizationResponseDto,
  ListPlatformOrganizationsQueryDto,
  ListPlatformUsersQueryDto,
  OffboardOrganizationDto,
  OffboardResponseDto,
  PlatformMetricsResponseDto,
  PlatformOrganizationResponseDto,
  PlatformUserResponseDto,
  RoleResponseDto,
  SetOrganizationStatusDto,
  UpdatePlatformOrganizationDto,
} from './dto/rest/platform.dto';
import { toPlatformOrganizationResponseDto } from './platform.mapper';

@Injectable()
export class PlatformGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'auth-service';

  private platformGrpcService!: PlatformServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.platformGrpcService = this.client.getService<PlatformServiceClient>(
      PLATFORM_SERVICE_NAME,
    );
  }

  async listOrganizations(
    query: ListPlatformOrganizationsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<PlatformOrganizationResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.platformGrpcService.listOrganizations(
          {
            page: toPageRequest(query),
            status:
              query.status === undefined
                ? undefined
                : toProtoOrgStatus(query.status),
            includeDeleted: query.includeDeleted,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toPlatformOrganizationResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async getOrganization(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.getOrganization(
            { organizationId },
            metadata,
          ),
        context,
      ),
    );
  }

  async createOrganization(
    dto: CreatePlatformOrganizationDto,
    context: RequestContext,
  ): Promise<CreatePlatformOrganizationResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.platformGrpcService.createOrganization(
          {
            name: dto.name,
            slug: dto.slug,
            domain: dto.domain,
            allowedEmailDomains: dto.allowedEmailDomains ?? [],
            adminEmail: dto.adminEmail,
            adminFullName: dto.adminFullName,
            maxAgentSeats: dto.maxAgentSeats,
            maxStorageBytes: dto.maxStorageBytes,
            monthlyAiTokenBudget: dto.monthlyAiTokenBudget,
          },
          metadata,
        ),
      context,
    );

    return {
      organization: toPlatformOrganizationResponseDto(response.organization!),
      admin: toUserResponseDto(response.admin!),
    };
  }

  async updateOrganization(
    organizationId: string,
    dto: UpdatePlatformOrganizationDto,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.updateOrganization(
            { organizationId, ...dto },
            metadata,
          ),
        context,
      ),
    );
  }

  async setStatus(
    organizationId: string,
    dto: SetOrganizationStatusDto,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.setOrganizationStatus(
            {
              organizationId,
              status: toProtoOrgStatus(dto.status),
              reason: dto.reason,
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async resetBillingCycle(
    organizationId: string,
    reason: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.resetBillingCycle(
            { organizationId, reason },
            metadata,
          ),
        context,
      ),
    );
  }

  offboard(
    organizationId: string,
    dto: OffboardOrganizationDto,
    context: RequestContext,
  ): Promise<OffboardResponseDto> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.offboardOrganization(
          { organizationId, reason: dto.reason },
          metadata,
        ),
      context,
    );
  }

  async restore(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.restoreOrganization(
            { organizationId },
            metadata,
          ),
        context,
      ),
    );
  }

  async listUsers(
    query: ListPlatformUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<PlatformUserResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.platformGrpcService.listUsers(
          {
            page: toPageRequest(query),
            organizationId: query.organizationId,
            includeDeleted: query.includeDeleted,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map((row) => ({
        user: toUserResponseDto(row.user!),
        organizationId: row.organizationId ?? null,
        organizationName: row.organizationName ?? null,
        roleNames: row.roleNames,
        deletedAt: fromProtoTimestamp(row.deletedAt) ?? null,
      })),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async listGlobalRoles(
    query: ListPlatformUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<RoleResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.platformGrpcService.listGlobalRoles(
          { page: toPageRequest(query) },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toRoleResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async createGlobalRole(
    dto: CreateGlobalRoleDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.createGlobalRole(
            {
              name: dto.name,
              description: dto.description,
              permissionCodes: dto.permissionCodes,
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async getMetrics(
    context: RequestContext,
  ): Promise<PlatformMetricsResponseDto> {
    const response = await this.call(
      (metadata) => this.platformGrpcService.getMetrics({}, metadata),
      context,
    );

    return {
      totalOrganizations: response.totalOrganizations,
      organizationsByStatus: response.organizationsByStatus,
      totalUsers: response.totalUsers,
      activeUsers: response.activeUsers,
      pendingInvitations: response.pendingInvitations,
      liveSessions: response.liveSessions,
      seatsAllocated: response.seatsAllocated,
      seatsInUse: response.seatsInUse,
      generatedAt: requireProtoTimestamp(response.generatedAt, 'generatedAt'),
    };
  }
}
