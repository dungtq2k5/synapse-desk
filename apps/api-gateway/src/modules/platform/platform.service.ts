import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { PlatformGrpcClient } from './platform-grpc.client';
import {
  toCreatePlatformOrganizationResponseDto,
  toGlobalRolePageDto,
  toListPlatformOrganizationsRequest,
  toListPlatformUsersRequest,
  toPlatformMetricsResponseDto,
  toPlatformOrganizationPageDto,
  toPlatformOrganizationResponseDto,
  toPlatformUserPageDto,
  toApplyPlanResponseDto,
  toCreatePlanRequest,
  toListPlansRequest,
  toSubscriptionPlanPageDto,
  toSubscriptionPlanResponseDto,
  toUpdatePlanRequest,
} from './platform.mapper';
import { toRoleResponseDto } from '../roles/role.mapper';
import {
  CreateGlobalRoleDto,
  CreatePlatformOrganizationDto,
  ListPlatformOrganizationsQueryDto,
  ListPlatformUsersQueryDto,
  OffboardOrganizationDto,
  RoleResponseDto,
  SetOrganizationStatusDto,
  UpdatePlatformOrganizationDto,
  CreatePlanDto,
  ListPlansQueryDto,
  UpdatePlanDto,
} from './dto/rest/platform.dto';
import {
  CreatePlatformOrganizationResponseDto,
  OffboardResponseDto,
  PlatformMetricsResponseDto,
  PlatformOrganizationResponseDto,
  PlatformUserResponseDto,
  ApplyPlanResponseDto,
  DeletePlanResponseDto,
  SubscriptionPlanResponseDto,
} from './dto/rest/platform-response.dto';

/** The platform-admin surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class PlatformService {
  constructor(private readonly platformGrpcClient: PlatformGrpcClient) {}

  async listOrganizations(
    query: ListPlatformOrganizationsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<PlatformOrganizationResponseDto>> {
    return toPlatformOrganizationPageDto(
      await this.platformGrpcClient.listOrganizations(
        toListPlatformOrganizationsRequest(query),
        context,
      ),
    );
  }

  async getOrganization(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.platformGrpcClient.getOrganization(organizationId, context),
    );
  }

  async createOrganization(
    dto: CreatePlatformOrganizationDto,
    context: RequestContext,
  ): Promise<CreatePlatformOrganizationResponseDto> {
    return toCreatePlatformOrganizationResponseDto(
      await this.platformGrpcClient.createOrganization(
        {
          name: dto.name,
          slug: dto.slug,
          domain: dto.domain,
          allowedEmailDomains: dto.allowedEmailDomains,
          adminEmail: dto.adminEmail,
          adminFullName: dto.adminFullName,
          maxAgentSeats: dto.maxAgentSeats,
          maxStorageBytes: dto.maxStorageBytes,
          monthlyAiTokenBudget: dto.monthlyAiTokenBudget,
        },
        context,
      ),
    );
  }

  async updateOrganization(
    organizationId: string,
    dto: UpdatePlatformOrganizationDto,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.platformGrpcClient.updateOrganization(
        { organizationId, ...dto },
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
      await this.platformGrpcClient.setStatus(
        {
          organizationId,
          status: toProtoOrgStatus(dto.status),
          reason: dto.reason,
        },
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
      await this.platformGrpcClient.resetBillingCycle(
        organizationId,
        reason,
        context,
      ),
    );
  }

  offboard(
    organizationId: string,
    dto: OffboardOrganizationDto,
    context: RequestContext,
  ): Promise<OffboardResponseDto> {
    return this.platformGrpcClient.offboard(
      organizationId,
      dto.reason,
      context,
    );
  }

  async restore(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponseDto> {
    return toPlatformOrganizationResponseDto(
      await this.platformGrpcClient.restore(organizationId, context),
    );
  }

  async listUsers(
    query: ListPlatformUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<PlatformUserResponseDto>> {
    return toPlatformUserPageDto(
      await this.platformGrpcClient.listUsers(
        toListPlatformUsersRequest(query),
        context,
      ),
    );
  }

  async listGlobalRoles(
    query: ListPlatformUsersQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<RoleResponseDto>> {
    return toGlobalRolePageDto(
      await this.platformGrpcClient.listGlobalRoles(
        { page: toListPlatformUsersRequest(query).page },
        context,
      ),
    );
  }

  async createGlobalRole(
    dto: CreateGlobalRoleDto,
    context: RequestContext,
  ): Promise<RoleResponseDto> {
    return toRoleResponseDto(
      await this.platformGrpcClient.createGlobalRole(
        {
          name: dto.name,
          description: dto.description,
          permissionCodes: dto.permissionCodes,
        },
        context,
      ),
    );
  }

  async getMetrics(
    context: RequestContext,
  ): Promise<PlatformMetricsResponseDto> {
    return toPlatformMetricsResponseDto(
      await this.platformGrpcClient.getMetrics(context),
    );
  }

  // -------------------------------------------------------------------------
  // The plan catalogue
  // -------------------------------------------------------------------------

  async listPlans(
    query: ListPlansQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<SubscriptionPlanResponseDto>> {
    return toSubscriptionPlanPageDto(
      await this.platformGrpcClient.listPlans(
        toListPlansRequest(query),
        context,
      ),
    );
  }

  async getPlan(
    planId: string,
    context: RequestContext,
  ): Promise<SubscriptionPlanResponseDto> {
    return toSubscriptionPlanResponseDto(
      await this.platformGrpcClient.getPlan(planId, context),
    );
  }

  async createPlan(
    dto: CreatePlanDto,
    context: RequestContext,
  ): Promise<SubscriptionPlanResponseDto> {
    return toSubscriptionPlanResponseDto(
      await this.platformGrpcClient.createPlan(
        toCreatePlanRequest(dto),
        context,
      ),
    );
  }

  async updatePlan(
    planId: string,
    dto: UpdatePlanDto,
    context: RequestContext,
  ): Promise<SubscriptionPlanResponseDto> {
    return toSubscriptionPlanResponseDto(
      await this.platformGrpcClient.updatePlan(
        toUpdatePlanRequest(planId, dto),
        context,
      ),
    );
  }

  async deletePlan(
    planId: string,
    context: RequestContext,
  ): Promise<DeletePlanResponseDto> {
    const response = await this.platformGrpcClient.deletePlan(planId, context);

    return { deleted: response.deleted };
  }

  async applyPlan(
    planId: string,
    dryRun: boolean,
    context: RequestContext,
  ): Promise<ApplyPlanResponseDto> {
    return toApplyPlanResponseDto(
      await this.platformGrpcClient.applyPlan({ planId, dryRun }, context),
    );
  }
}
