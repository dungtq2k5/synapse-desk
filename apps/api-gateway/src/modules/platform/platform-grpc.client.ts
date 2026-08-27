import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  CreateGlobalRoleRequest,
  CreatePlatformOrganizationRequest,
  CreatePlatformOrganizationResponse,
  ListGlobalRolesRequest,
  ListGlobalRolesResponse,
  ListPlatformOrganizationsRequest,
  ListPlatformOrganizationsResponse,
  ListPlatformUsersRequest,
  ListPlatformUsersResponse,
  OffboardOrganizationResponse,
  PLATFORM_SERVICE_NAME,
  PlatformMetricsResponse,
  PlatformOrganizationResponse,
  PlatformServiceClient,
  RoleResponse,
  SetOrganizationStatusRequest,
  UpdatePlatformOrganizationRequest,
  ApplyPlanRequest,
  ApplyPlanResponse,
  CreatePlanRequest,
  DeletePlanResponse,
  ListPlansRequest,
  ListPlansResponse,
  SubscriptionPlanResponse,
  UpdatePlanRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

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

  listOrganizations(
    request: ListPlatformOrganizationsRequest,
    context: RequestContext,
  ): Promise<ListPlatformOrganizationsResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.listOrganizations(request, metadata),
      context,
    );
  }

  getOrganization(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.getOrganization({ organizationId }, metadata),
      context,
    );
  }

  createOrganization(
    request: CreatePlatformOrganizationRequest,
    context: RequestContext,
  ): Promise<CreatePlatformOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.createOrganization(request, metadata),
      context,
    );
  }

  updateOrganization(
    request: UpdatePlatformOrganizationRequest,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.updateOrganization(request, metadata),
      context,
    );
  }

  setStatus(
    request: SetOrganizationStatusRequest,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.setOrganizationStatus(request, metadata),
      context,
    );
  }

  resetBillingCycle(
    organizationId: string,
    reason: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.resetBillingCycle(
          { organizationId, reason },
          metadata,
        ),
      context,
    );
  }

  offboard(
    organizationId: string,
    reason: string,
    context: RequestContext,
  ): Promise<OffboardOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.offboardOrganization(
          { organizationId, reason },
          metadata,
        ),
      context,
    );
  }

  restore(
    organizationId: string,
    context: RequestContext,
  ): Promise<PlatformOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.restoreOrganization(
          { organizationId },
          metadata,
        ),
      context,
    );
  }

  listUsers(
    request: ListPlatformUsersRequest,
    context: RequestContext,
  ): Promise<ListPlatformUsersResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.listUsers(request, metadata),
      context,
    );
  }

  listGlobalRoles(
    request: ListGlobalRolesRequest,
    context: RequestContext,
  ): Promise<ListGlobalRolesResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.listGlobalRoles(request, metadata),
      context,
    );
  }

  createGlobalRole(
    request: CreateGlobalRoleRequest,
    context: RequestContext,
  ): Promise<RoleResponse> {
    return this.call(
      (metadata) =>
        this.platformGrpcService.createGlobalRole(request, metadata),
      context,
    );
  }

  getMetrics(context: RequestContext): Promise<PlatformMetricsResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.getMetrics({}, metadata),
      context,
    );
  }
  // -------------------------------------------------------------------------
  // The plan catalogue
  // -------------------------------------------------------------------------

  listPlans(
    request: ListPlansRequest,
    context: RequestContext,
  ): Promise<ListPlansResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.listPlans(request, metadata),
      context,
    );
  }

  getPlan(
    planId: string,
    context: RequestContext,
  ): Promise<SubscriptionPlanResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.getPlan({ planId }, metadata),
      context,
    );
  }

  createPlan(
    request: CreatePlanRequest,
    context: RequestContext,
  ): Promise<SubscriptionPlanResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.createPlan(request, metadata),
      context,
    );
  }

  updatePlan(
    request: UpdatePlanRequest,
    context: RequestContext,
  ): Promise<SubscriptionPlanResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.updatePlan(request, metadata),
      context,
    );
  }

  deletePlan(
    planId: string,
    context: RequestContext,
  ): Promise<DeletePlanResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.deletePlan({ planId }, metadata),
      context,
    );
  }

  applyPlan(
    request: ApplyPlanRequest,
    context: RequestContext,
  ): Promise<ApplyPlanResponse> {
    return this.call(
      (metadata) => this.platformGrpcService.applyPlan(request, metadata),
      context,
    );
  }
}
