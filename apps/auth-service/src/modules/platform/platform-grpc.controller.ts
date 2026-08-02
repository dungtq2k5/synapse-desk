import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
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
  PlatformOrganizationIdRequest,
  PlatformOrganizationResponse,
  PlatformServiceController,
  PlatformServiceControllerMethods,
  ResetBillingCycleRequest,
  RoleResponse,
  SetOrganizationStatusRequest,
  unpackCallerContext,
  UpdatePlatformOrganizationRequest,
} from '@synapsedesk/grpc-proto';
import { PlatformService } from './platform.service';

/**
 * Authorization for this whole surface lives at the GATEWAY, in
 * `SuperAdminGuard`. This service trusts that gate — the same arrangement as
 * every permission-gated RPC — which is why nothing here re-checks
 * `isSuperAdmin`.
 */
@Controller()
@PlatformServiceControllerMethods()
export class PlatformGrpcController implements PlatformServiceController {
  constructor(private readonly platformService: PlatformService) {}

  listOrganizations(
    request: ListPlatformOrganizationsRequest,
  ): Promise<ListPlatformOrganizationsResponse> {
    return this.platformService.listOrganizations(request);
  }

  createOrganization(
    request: CreatePlatformOrganizationRequest,
    metadata?: Metadata,
  ): Promise<CreatePlatformOrganizationResponse> {
    return this.platformService.createOrganization(
      request,
      unpackCallerContext(metadata),
    );
  }

  getOrganization(
    request: PlatformOrganizationIdRequest,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.getOrganization(request);
  }

  updateOrganization(
    request: UpdatePlatformOrganizationRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.updateOrganization(
      request,
      unpackCallerContext(metadata),
    );
  }

  setOrganizationStatus(
    request: SetOrganizationStatusRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.setOrganizationStatus(
      request,
      unpackCallerContext(metadata),
    );
  }

  resetBillingCycle(
    request: ResetBillingCycleRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.resetBillingCycle(
      request,
      unpackCallerContext(metadata),
    );
  }

  offboardOrganization(
    request: OffboardOrganizationRequest,
    metadata?: Metadata,
  ): Promise<OffboardOrganizationResponse> {
    return this.platformService.offboardOrganization(
      request,
      unpackCallerContext(metadata),
    );
  }

  restoreOrganization(
    request: PlatformOrganizationIdRequest,
    metadata?: Metadata,
  ): Promise<PlatformOrganizationResponse> {
    return this.platformService.restoreOrganization(
      request,
      unpackCallerContext(metadata),
    );
  }

  listUsers(
    request: ListPlatformUsersRequest,
  ): Promise<ListPlatformUsersResponse> {
    return this.platformService.listUsers(request);
  }

  listGlobalRoles(
    request: ListGlobalRolesRequest,
  ): Promise<ListGlobalRolesResponse> {
    return this.platformService.listGlobalRoles(request);
  }

  createGlobalRole(
    request: CreateGlobalRoleRequest,
    metadata?: Metadata,
  ): Promise<RoleResponse> {
    return this.platformService.createGlobalRole(
      request,
      unpackCallerContext(metadata),
    );
  }

  getMetrics(): Promise<PlatformMetricsResponse> {
    return this.platformService.getMetrics();
  }
}
