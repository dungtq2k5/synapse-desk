import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  IssueInboundTokenResponse,
  OnboardingResponse,
  OrganizationResponse,
  OrganizationSettingsResponse,
  OrganizationUsageResponse,
  DeleteOrganizationResponse,
  UpdateOrganizationRequest,
  UpdateOrganizationSettingsRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

@Injectable()
export class OrganizationsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private organizationGrpcService!: OrganizationServiceClient;

  constructor(@Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.organizationGrpcService =
      this.client.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
  }

  /** Issues or rotates the tenant's inbound-mail token. */
  issueInboundToken(
    context: RequestContext,
  ): Promise<IssueInboundTokenResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.issueInboundToken({}, metadata),
      context,
    );
  }

  /** Switches inbound mail off. Idempotent — see the service. */
  async revokeInboundToken(context: RequestContext): Promise<void> {
    await this.call(
      (metadata) =>
        this.organizationGrpcService.revokeInboundToken({}, metadata),
      context,
    );
  }

  getCurrent(context: RequestContext): Promise<OrganizationResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.getCurrentOrganization({}, metadata),
      context,
    );
  }

  update(
    request: UpdateOrganizationRequest,
    context: RequestContext,
  ): Promise<OrganizationResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.updateOrganization(request, metadata),
      context,
    );
  }

  getSettings(context: RequestContext): Promise<OrganizationSettingsResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.getOrganizationSettings({}, metadata),
      context,
    );
  }

  updateSettings(
    request: UpdateOrganizationSettingsRequest,
    context: RequestContext,
  ): Promise<OrganizationSettingsResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.updateOrganizationSettings(
          request,
          metadata,
        ),
      context,
    );
  }

  getUsage(context: RequestContext): Promise<OrganizationUsageResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.getOrganizationUsage({}, metadata),
      context,
    );
  }

  getOnboarding(context: RequestContext): Promise<OnboardingResponse> {
    return this.call(
      (metadata) => this.organizationGrpcService.getOnboarding({}, metadata),
      context,
    );
  }

  completeOnboarding(context: RequestContext): Promise<OrganizationResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.completeOnboarding({}, metadata),
      context,
    );
  }

  requestOffboard(
    reason: string,
    context: RequestContext,
  ): Promise<DeleteOrganizationResponse> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.deleteOrganization({ reason }, metadata),
      context,
    );
  }
}
