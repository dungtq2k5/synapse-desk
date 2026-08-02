import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  fromTimestamp,
  PLATFORM_SERVICE_NAME,
  PlatformOrganizationResponse,
  PlatformServiceClient,
  requireTimestamp,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { toPaginationMeta } from '../../common/mappers/pagination.mapper';
import { toUserResponseDto } from '../users/user.mapper';
import { toRoleDto } from '../roles/role.mapper';
import { toOrganizationDto } from '../organizations/organization.mapper';
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
  ): Promise<PaginationResponseBase<PlatformOrganizationResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.platformGrpcService.listOrganizations(
          {
            page: toPageRequest(query),
            status: query.status,
            includeDeleted: query.includeDeleted,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toPlatformOrganizationDto),
      meta: toPaginationMeta(response.meta),
    };
  }

  async getOrganization(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationDto(
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
      organization: toPlatformOrganizationDto(response.organization!),
      admin: toUserResponseDto(response.admin!),
    };
  }

  async updateOrganization(
    organizationId: string,
    dto: UpdatePlatformOrganizationDto,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationDto(
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
    return toPlatformOrganizationDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.setOrganizationStatus(
            { organizationId, status: dto.status, reason: dto.reason },
            metadata,
          ),
        context,
      ),
    );
  }

  async resetBillingCycle(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationDto(
      await this.call(
        (metadata) =>
          this.platformGrpcService.resetBillingCycle(
            { organizationId },
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
    return toPlatformOrganizationDto(
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
  ): Promise<PaginationResponseBase<PlatformUserResponseDto>> {
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
        deletedAt: fromTimestamp(row.deletedAt) ?? null,
      })),
      meta: toPaginationMeta(response.meta),
    };
  }

  async listGlobalRoles(
    query: ListPlatformUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseBase<RoleResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.platformGrpcService.listGlobalRoles(
          { page: toPageRequest(query) },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toRoleDto),
      meta: toPaginationMeta(response.meta),
    };
  }

  async createGlobalRole(
    dto: CreateGlobalRoleDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleDto(
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
      generatedAt: requireTimestamp(response.generatedAt, 'generatedAt'),
    };
  }
}

function toPlatformOrganizationDto(
  row: PlatformOrganizationResponse,
): PlatformOrganizationResponseDto {
  return {
    organization: toOrganizationDto(row.organization!),
    userCount: row.userCount,
    pendingInvitationCount: row.pendingInvitationCount,
    departmentCount: row.departmentCount,
    deletedAt: fromTimestamp(row.deletedAt) ?? null,
  };
}
