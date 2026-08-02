import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  requireTimestamp,
  UsageMeter,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { toOrganizationDto } from './organization.mapper';
import {
  DeleteOrganizationDto,
  OffboardResponseDto,
  OnboardingResponseDto,
  OrganizationResponseDto,
  OrganizationSettingsResponseDto,
  OrganizationUsageResponseDto,
  UpdateOrganizationDto,
  UpdateOrganizationSettingsDto,
  UsageMeterDto,
} from './dto/rest/organization.dto';

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

  async getCurrent(context: RequestContext): Promise<OrganizationResponseDto> {
    return toOrganizationDto(
      await this.call(
        (metadata) =>
          this.organizationGrpcService.getCurrentOrganization({}, metadata),
        context,
      ),
    );
  }

  async update(
    dto: UpdateOrganizationDto,
    context: RequestContext,
  ): Promise<OrganizationResponseDto> {
    return toOrganizationDto(
      await this.call(
        (metadata) =>
          this.organizationGrpcService.updateOrganization(
            { name: dto.name, slug: dto.slug, domain: dto.domain },
            metadata,
          ),
        context,
      ),
    );
  }

  getSettings(
    context: RequestContext,
  ): Promise<OrganizationSettingsResponseDto> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.getOrganizationSettings({}, metadata),
      context,
    );
  }

  updateSettings(
    dto: UpdateOrganizationSettingsDto,
    context: RequestContext,
  ): Promise<OrganizationSettingsResponseDto> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.updateOrganizationSettings(
          {
            enforceTwoFactor: dto.enforceTwoFactor,
            allowedEmailDomains: dto.allowedEmailDomains ?? [],
            // protobuf cannot distinguish an omitted repeated field from an
            // empty one, so presence at the REST edge is carried explicitly.
            // Without this, an update touching only `enforceTwoFactor` would
            // wipe the domain allowlist.
            replaceAllowedEmailDomains: dto.allowedEmailDomains !== undefined,
          },
          metadata,
        ),
      context,
    );
  }

  async getUsage(
    context: RequestContext,
  ): Promise<OrganizationUsageResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.organizationGrpcService.getOrganizationUsage({}, metadata),
      context,
    );

    return {
      seats: toMeterDto(response.seats),
      storage: toMeterDto(response.storage),
      aiTokens: toMeterDto(response.aiTokens),
      billingCycleStart: requireTimestamp(
        response.billingCycleStart,
        'billingCycleStart',
      ),
    };
  }

  getOnboarding(context: RequestContext): Promise<OnboardingResponseDto> {
    return this.call(
      (metadata) => this.organizationGrpcService.getOnboarding({}, metadata),
      context,
    );
  }

  async completeOnboarding(
    context: RequestContext,
  ): Promise<OrganizationResponseDto> {
    return toOrganizationDto(
      await this.call(
        (metadata) =>
          this.organizationGrpcService.completeOnboarding({}, metadata),
        context,
      ),
    );
  }

  requestOffboard(
    dto: DeleteOrganizationDto,
    context: RequestContext,
  ): Promise<OffboardResponseDto> {
    return this.call(
      (metadata) =>
        this.organizationGrpcService.deleteOrganization(
          { reason: dto.reason },
          metadata,
        ),
      context,
    );
  }
}

/**
 * Unset numbers become `null`, never 0.
 *
 * A meter reporting `used: 0` claims the tenant has consumed nothing; a meter
 * whose domain does not exist yet cannot make that claim, and the difference
 * matters to anyone reading a usage page before deciding to upgrade.
 */
function toMeterDto(meter: UsageMeter | undefined): UsageMeterDto {
  if (!meter) {
    throw new Error('Received a usage response without a meter');
  }

  return {
    available: meter.available,
    used: meter.available ? (meter.used ?? null) : null,
    limit: meter.available ? (meter.limit ?? null) : null,
    unavailableReason: meter.unavailableReason ?? null,
  };
}
