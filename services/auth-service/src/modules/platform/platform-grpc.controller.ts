import { JobHealthService, requireSuperAdmin } from '@synapsedesk/nest-common';
import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AuthJobHealthResponse,
  toProtoTimestamp,
  CreateGlobalRoleRequest,
  CreatePlatformOrganizationRequest,
  CreatePlatformOrganizationResponse,
  ListGlobalRolesRequest,
  ListGlobalRolesResponse,
  ListPlatformOrganizationsRequest,
  ListPlatformOrganizationsResponse,
  ListPlatformUsersRequest,
  ListPlatformUsersResponse,
  OffboardOrganizationRequest,
  OffboardOrganizationResponse,
  PlatformMetricsResponse,
  OrganizationUsageResponse,
  PlatformOrganizationIdRequest,
  ResolveAuditNamesRequest,
  ResolveAuditNamesResponse,
  PlatformOrganizationResponse,
  PlatformServiceController,
  PlatformServiceControllerMethods,
  ResetBillingCycleRequest,
  RoleResponse,
  SetOrganizationStatusRequest,
  unpackCallerContext,
  CallerContext,
  GetPlatformMetricsRequest,
  GetFinanceSnapshotRequest,
  unpackRequestOrigin,
  UpdatePlatformOrganizationRequest,
  ApplyPlanRequest,
  ApplyPlanResponse,
  AssignPlanRequest,
  ReleasePlanRequest,
  CreatePlanRequest,
  DeletePlanResponse,
  ListPlansRequest,
  ListPlansResponse,
  PlanIdRequest,
  SubscriptionPlanResponse,
  UpdatePlanRequest,
  FinanceSnapshotResponse,
  ListBillingEventsRequest,
  ListBillingEventsResponse,
} from '@synapsedesk/grpc-proto';
import { PlatformService } from './platform.service';
import { PlanAdminService } from '../billing/plan-admin.service';
import { FinanceService } from '../finance/finance.service';

/**
 * Authorization for this whole surface is checked twice: at the GATEWAY, in
 * `SuperAdminGuard`, and here, by `requireSuperAdmin` on every RPC but the job
 * heartbeat. Each read here crosses tenants, so a gRPC caller that skipped the
 * gateway must not get one.
 */
@Controller()
@PlatformServiceControllerMethods()
export class PlatformGrpcController implements PlatformServiceController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly planAdmin: PlanAdminService,
    private readonly jobHealth: JobHealthService,
    private readonly finance: FinanceService,
  ) {}

  listOrganizations(
    request: ListPlatformOrganizationsRequest,
    metadata?: Metadata,
  ): Promise<ListPlatformOrganizationsResponse> {
    this.superAdmin(metadata);
    return this.platformService.listOrganizations(request);
  }

  createOrganization(
    request: CreatePlatformOrganizationRequest,
    metadata?: Metadata,
  ): Promise<CreatePlatformOrganizationResponse> {
    return this.platformService.createOrganization(
      request,
      this.superAdmin(metadata),
      unpackRequestOrigin(metadata),
    );
  }

  getOrganization(
    request: PlatformOrganizationIdRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    this.superAdmin(metadata);
    return this.platformService.getOrganization(request);
  }

  getOrganizationUsage(
    request: PlatformOrganizationIdRequest,
    metadata?: Metadata,
  ): Promise<OrganizationUsageResponse> {
    return this.platformService.getOrganizationUsage(
      request,
      this.superAdmin(metadata),
    );
  }

  updateOrganization(
    request: UpdatePlatformOrganizationRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.updateOrganization(
      request,
      this.superAdmin(metadata),
    );
  }

  setOrganizationStatus(
    request: SetOrganizationStatusRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.setOrganizationStatus(
      request,
      this.superAdmin(metadata),
    );
  }

  resetBillingCycle(
    request: ResetBillingCycleRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.resetBillingCycle(
      request,
      this.superAdmin(metadata),
    );
  }

  offboardOrganization(
    request: OffboardOrganizationRequest,
    metadata?: Metadata,
  ): Promise<OffboardOrganizationResponse> {
    return this.platformService.offboardOrganization(
      request,
      this.superAdmin(metadata),
    );
  }

  restoreOrganization(
    request: PlatformOrganizationIdRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.restoreOrganization(
      request,
      this.superAdmin(metadata),
    );
  }

  listUsers(
    request: ListPlatformUsersRequest,
    metadata?: Metadata,
  ): Promise<ListPlatformUsersResponse> {
    this.superAdmin(metadata);
    return this.platformService.listUsers(request);
  }

  listGlobalRoles(
    request: ListGlobalRolesRequest,
    metadata?: Metadata,
  ): Promise<ListGlobalRolesResponse> {
    this.superAdmin(metadata);
    return this.platformService.listGlobalRoles(request);
  }

  createGlobalRole(
    request: CreateGlobalRoleRequest,
    metadata?: Metadata,
  ): Promise<RoleResponse> {
    return this.platformService.createGlobalRole(
      request,
      this.superAdmin(metadata),
    );
  }

  // ---------------------------------------------------------------- The plan catalogue
  // Delegates to `PlanAdminService` rather than `PlatformService`: a plan is
  // not a tenant, and the two services already differ in what they own.

  listPlans(
    request: ListPlansRequest,
    metadata?: Metadata,
  ): Promise<ListPlansResponse> {
    return this.planAdmin.listPlans(request, this.superAdmin(metadata));
  }

  createPlan(
    request: CreatePlanRequest,
    metadata?: Metadata,
  ): Promise<SubscriptionPlanResponse> {
    return this.planAdmin.createPlan(request, this.superAdmin(metadata));
  }

  getPlan(
    request: PlanIdRequest,
    metadata?: Metadata,
  ): Promise<SubscriptionPlanResponse> {
    return this.planAdmin.getPlan(request.planId, this.superAdmin(metadata));
  }

  updatePlan(
    request: UpdatePlanRequest,
    metadata?: Metadata,
  ): Promise<SubscriptionPlanResponse> {
    return this.planAdmin.updatePlan(request, this.superAdmin(metadata));
  }

  async deletePlan(
    request: PlanIdRequest,
    metadata?: Metadata,
  ): Promise<DeletePlanResponse> {
    return {
      deleted: await this.planAdmin.deletePlan(
        request.planId,
        this.superAdmin(metadata),
      ),
    };
  }

  applyPlan(
    request: ApplyPlanRequest,
    metadata?: Metadata,
  ): Promise<ApplyPlanResponse> {
    return this.planAdmin.applyPlan(request, this.superAdmin(metadata));
  }

  assignPlan(
    request: AssignPlanRequest,
    metadata?: Metadata,
  ): Promise<ApplyPlanResponse> {
    return this.planAdmin.assignPlan(request, this.superAdmin(metadata));
  }

  releasePlan(
    request: ReleasePlanRequest,
    metadata?: Metadata,
  ): Promise<ApplyPlanResponse> {
    return this.planAdmin.releasePlan(request, this.superAdmin(metadata));
  }

  getMetrics(
    _request: GetPlatformMetricsRequest,
    metadata?: Metadata,
  ): Promise<PlatformMetricsResponse> {
    this.superAdmin(metadata);
    return this.platformService.getMetrics();
  }

  /**
   * The snapshot: plan mix, dunning and the revenue estimate.
   *
   * Separate from `getMetrics` because it has a Stripe leg that can degrade,
   * and merging them would let a Stripe outage take the tenancy dashboard with
   * it.
   */
  getFinanceSnapshot(
    _request: GetFinanceSnapshotRequest,
    metadata?: Metadata,
  ): Promise<FinanceSnapshotResponse> {
    this.superAdmin(metadata);
    return this.finance.getSnapshot();
  }

  /** The time series. Entirely local, and therefore always answerable. */
  listBillingEvents(
    request: ListBillingEventsRequest,
    metadata?: Metadata,
  ): Promise<ListBillingEventsResponse> {
    this.superAdmin(metadata);
    return this.finance.listEvents(request);
  }

  /**
   * The heartbeat.
   *
   * Every row, unjudged: the staleness decision needs the list of jobs this
   * build EXPECTS, because a job that has never run has no row to return.
   */
  resolveAuditNames(
    request: ResolveAuditNamesRequest,
    metadata?: Metadata,
  ): Promise<ResolveAuditNamesResponse> {
    return this.platformService.resolveAuditNames(
      request,
      this.superAdmin(metadata),
    );
  }

  /**
   * The one RPC here open to any caller: the gateway's metrics scrape reads it
   * with no user, and it returns job heartbeats, no tenant's data.
   */
  async getAuthJobHealth(): Promise<AuthJobHealthResponse> {
    const rows = await this.jobHealth.list();

    return {
      items: rows.map((row) => ({
        jobName: row.jobName,
        lastStartedAt: row.lastStartedAt
          ? toProtoTimestamp(row.lastStartedAt)
          : undefined,
        lastSucceededAt: row.lastSucceededAt
          ? toProtoTimestamp(row.lastSucceededAt)
          : undefined,
        lastDurationMs: row.lastDurationMs ?? undefined,
        lastError: row.lastError ?? undefined,
        consecutiveFailures: row.consecutiveFailures,
      })),
    };
  }

  /** The caller's context, once it's proven a Super Admin's. */
  private superAdmin(metadata?: Metadata): CallerContext {
    const context = unpackCallerContext(metadata);
    requireSuperAdmin(context);

    return context;
  }
}
