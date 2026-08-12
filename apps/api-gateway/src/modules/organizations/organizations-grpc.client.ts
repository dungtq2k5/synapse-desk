import { ConfigService } from '@nestjs/config';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  fromProtoAiModelTier,
  requireProtoTimestamp,
  fromProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import { buildInboundAddress, RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import {
  toOrganizationResponseDto,
  toUsageMeterDto,
} from './organization.mapper';
import { InboundAddressResponseDto } from './dto/rest/inbound-address.dto';
import {
  DeleteOrganizationDto,
  OffboardResponseDto,
  OnboardingResponseDto,
  OrganizationResponseDto,
  OrganizationSettingsResponseDto,
  OrganizationUsageResponseDto,
  UpdateOrganizationDto,
  UpdateOrganizationSettingsDto,
} from './dto/rest/organization.dto';

@Injectable()
export class OrganizationsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private organizationGrpcService!: OrganizationServiceClient;

  constructor(
    @Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  onModuleInit() {
    this.organizationGrpcService =
      this.client.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
  }

  /**
   * Issues or rotates the tenant's inbound-mail address — 31-doc §2.
   *
   * Returns the ADDRESS rather than the bare token, because the token alone is
   * unusable: the mail domain is deployment configuration, and a client that
   * had to assemble the two would be the third place that format is spelled.
   */
  async issueInboundToken(
    context: RequestContext,
  ): Promise<InboundAddressResponseDto> {
    const { inboundToken } = await this.call(
      (metadata) =>
        this.organizationGrpcService.issueInboundToken({}, metadata),
      context,
    );

    return { inboundAddress: this.addressFor(inboundToken) };
  }

  /** Switches inbound mail off. Idempotent — see the service. */
  async revokeInboundToken(context: RequestContext): Promise<void> {
    await this.call(
      (metadata) =>
        this.organizationGrpcService.revokeInboundToken({}, metadata),
      context,
    );
  }

  private addressFor(inboundToken: string): string {
    return buildInboundAddress(
      this.configService.getOrThrow<string>('INBOUND_EMAIL_DOMAIN'),
      inboundToken,
    );
  }

  async getCurrent(context: RequestContext): Promise<OrganizationResponseDto> {
    return toOrganizationResponseDto(
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
    return toOrganizationResponseDto(
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
      seats: toUsageMeterDto(response.seats),
      storage: toUsageMeterDto(response.storage),
      aiTokens: toUsageMeterDto(response.aiTokens),
      // Mapped back to the DOMAIN string rather than passed through as a proto
      // enum number: `aiModelTier: 1` in a JSON body is meaningless to the
      // client that has to render it.
      aiModelTier: fromProtoAiModelTier(response.aiModelTier),
      planName: response.planName,
      currentPeriodEnd: response.currentPeriodEnd
        ? requireProtoTimestamp(response.currentPeriodEnd, 'currentPeriodEnd')
        : null,
      billingCycleStart: requireProtoTimestamp(
        response.billingCycleStart,
        'billingCycleStart',
      ),
    };
  }

  async getOnboarding(context: RequestContext): Promise<OnboardingResponseDto> {
    const response = await this.call(
      (metadata) => this.organizationGrpcService.getOnboarding({}, metadata),
      context,
    );

    // Mapped rather than passed through: `status` is a proto enum on the wire
    // and a string in the DTO, so returning the response verbatim would ship a
    // NUMBER to the client under a field the contract types as a string.
    return { ...response, status: fromProtoOrgStatus(response.status) ?? '' };
  }

  async completeOnboarding(
    context: RequestContext,
  ): Promise<OrganizationResponseDto> {
    return toOrganizationResponseDto(
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
