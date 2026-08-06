import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  CompleteOnboardingRequest,
  DeleteOrganizationRequest,
  DeleteOrganizationResponse,
  GetOrganizationStatusRequest,
  OrganizationStatusResponse,
  OnboardingResponse,
  OrganizationResponse,
  OrganizationServiceController,
  OrganizationServiceControllerMethods,
  OrganizationSettingsResponse,
  GetOrganizationEntitlementsRequest,
  OrganizationEntitlementsResponse,
  OrganizationUsageResponse,
  unpackCallerContext,
  UpdateOrganizationRequest,
  UpdateOrganizationSettingsRequest,
} from '@synapsedesk/grpc-proto';
import { OrganizationsService } from './organizations.service';

/**
 * No method takes an organization id: every one resolves the tenant from the
 * verified caller context, so there is no request shape in which a tenant admin
 * could name someone else's workspace.
 */
@Controller()
@OrganizationServiceControllerMethods()
export class OrganizationsGrpcController implements OrganizationServiceController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  getCurrentOrganization(
    _request: unknown,
    metadata?: Metadata,
  ): Promise<OrganizationResponse> {
    return this.organizationsService.getCurrentOrganization(
      unpackCallerContext(metadata),
    );
  }

  getOrganizationStatus(
    request: GetOrganizationStatusRequest,
  ): Promise<OrganizationStatusResponse> {
    return this.organizationsService.getOrganizationStatus(request);
  }

  updateOrganization(
    request: UpdateOrganizationRequest,
    metadata?: Metadata,
  ): Promise<OrganizationResponse> {
    return this.organizationsService.updateOrganization(
      request,
      unpackCallerContext(metadata),
    );
  }

  getOrganizationSettings(
    _request: unknown,
    metadata?: Metadata,
  ): Promise<OrganizationSettingsResponse> {
    return this.organizationsService.getOrganizationSettings(
      unpackCallerContext(metadata),
    );
  }

  updateOrganizationSettings(
    request: UpdateOrganizationSettingsRequest,
    metadata?: Metadata,
  ): Promise<OrganizationSettingsResponse> {
    return this.organizationsService.updateOrganizationSettings(
      request,
      unpackCallerContext(metadata),
    );
  }

  getOrganizationUsage(
    _request: unknown,
    metadata?: Metadata,
  ): Promise<OrganizationUsageResponse> {
    return this.organizationsService.getOrganizationUsage(
      unpackCallerContext(metadata),
    );
  }

  /**
   * Read by the two spending services and CACHED there, so this is a cache
   * fill rather than a per-request call (doc 15 §1.3, §3.1).
   */
  getOrganizationEntitlements(
    _request: GetOrganizationEntitlementsRequest,
    metadata?: Metadata,
  ): Promise<OrganizationEntitlementsResponse> {
    return this.organizationsService.getOrganizationEntitlements(
      unpackCallerContext(metadata),
    );
  }

  getOnboarding(
    _request: unknown,
    metadata?: Metadata,
  ): Promise<OnboardingResponse> {
    return this.organizationsService.getOnboarding(
      unpackCallerContext(metadata),
    );
  }

  completeOnboarding(
    request: CompleteOnboardingRequest,
    metadata?: Metadata,
  ): Promise<OrganizationResponse> {
    return this.organizationsService.completeOnboarding(
      request,
      unpackCallerContext(metadata),
    );
  }

  deleteOrganization(
    request: DeleteOrganizationRequest,
    metadata?: Metadata,
  ): Promise<DeleteOrganizationResponse> {
    return this.organizationsService.deleteOrganization(
      request,
      unpackCallerContext(metadata),
    );
  }
}
