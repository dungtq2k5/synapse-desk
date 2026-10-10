import { Injectable, Logger } from '@nestjs/common';
import {
  toOrganizationSettingsResponseDto,
  toOnboardingResponseDto,
  toOrganizationResponseDto,
  toOrganizationUsageResponseDto,
} from './organization.mapper';
import { ConfigService } from '@nestjs/config';
import {
  buildInboundAddress,
  formatErrorMsg,
  RequestContext,
} from '@synapsedesk/common';
import { OrganizationsGrpcClient } from './organizations-grpc.client';
import { DocumentsGrpcClient } from '../documents/documents-grpc.client';
import type { StorageUsageResponse } from '@synapsedesk/grpc-proto';
import { InboundAddressResponseDto } from './dto/rest/inbound-address-response.dto';
import {
  DeleteOrganizationDto,
  UpdateOrganizationDto,
  UpdateOrganizationSettingsDto,
} from './dto/rest/organization.dto';
import {
  OffboardResponseDto,
  OnboardingResponseDto,
  OrganizationResponseDto,
  OrganizationSettingsResponseDto,
  OrganizationUsageResponseDto,
} from './dto/rest/organization-response.dto';

/** The gateway's organization surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly organizationsGrpcClient: OrganizationsGrpcClient,
    private readonly documentsGrpcClient: DocumentsGrpcClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Issues or rotates the tenant's inbound-mail address.
   *
   * Returns the ADDRESS rather than the bare token: the mail domain is
   * deployment configuration, and a client assembling the two would be a third
   * place that format is spelled.
   */
  async issueInboundToken(
    context: RequestContext,
  ): Promise<InboundAddressResponseDto> {
    const { inboundToken } =
      await this.organizationsGrpcClient.issueInboundToken(context);

    return {
      inboundAddress: buildInboundAddress(
        this.configService.getOrThrow<string>('INBOUND_EMAIL_DOMAIN'),
        inboundToken,
      ),
    };
  }

  /** Switches inbound mail off. Idempotent. */
  revokeInboundToken(context: RequestContext): Promise<void> {
    return this.organizationsGrpcClient.revokeInboundToken(context);
  }

  async getCurrent(context: RequestContext): Promise<OrganizationResponseDto> {
    return toOrganizationResponseDto(
      await this.organizationsGrpcClient.getCurrent(context),
    );
  }

  async update(
    dto: UpdateOrganizationDto,
    context: RequestContext,
  ): Promise<OrganizationResponseDto> {
    return toOrganizationResponseDto(
      await this.organizationsGrpcClient.update(
        { name: dto.name, slug: dto.slug, domain: dto.domain },
        context,
      ),
    );
  }

  async getSettings(
    context: RequestContext,
  ): Promise<OrganizationSettingsResponseDto> {
    return this.organizationsGrpcClient
      .getSettings(context)
      .then(toOrganizationSettingsResponseDto);
  }

  async updateSettings(
    dto: UpdateOrganizationSettingsDto,
    context: RequestContext,
  ): Promise<OrganizationSettingsResponseDto> {
    return this.organizationsGrpcClient
      .updateSettings(
        {
          enforceTwoFactor: dto.enforceTwoFactor,
          allowedEmailDomains: dto.allowedEmailDomains ?? [],
          // protobuf cannot distinguish an omitted repeated field from an empty
          // one, so presence at the REST edge is carried explicitly. Without it,
          // an update touching only `enforceTwoFactor` wipes the allowlist.
          replaceAllowedEmailDomains: dto.allowedEmailDomains !== undefined,
          // Three states across a wire that carries two. `null` at the edge means
          // "clear it" and travels as a flag; a value travels as a value; absent
          // travels as neither. See the request message.
          maxDocumentBytesOverride: dto.maxDocumentBytesOverride ?? undefined,
          clearMaxDocumentBytesOverride: dto.maxDocumentBytesOverride === null,
          maxAttachmentBytesOverride:
            dto.maxAttachmentBytesOverride ?? undefined,
          clearMaxAttachmentBytesOverride:
            dto.maxAttachmentBytesOverride === null,
          maxAttachmentsPerMessageOverride:
            dto.maxAttachmentsPerMessageOverride ?? undefined,
          clearMaxAttachmentsPerMessageOverride:
            dto.maxAttachmentsPerMessageOverride === null,
        },
        context,
      )
      .then(toOrganizationSettingsResponseDto);
  }

  /**
   * The three meters, composed from the two services that own them.
   *
   * `auth-service` answers seats and cannot answer storage: it does not count
   * documents and cannot dial `ingestion-service`, which dials auth on every
   * presign — the reverse edge would close a cycle on the identity leaf. So the
   * storage meter is filled HERE, the same fold the plan-apply projection uses,
   * for the same reason.
   *
   * **A REPORT may degrade, and this is a report.** An unavailable ingestion
   * leaves the meter `available: false` with a reason, rather than failing the
   * whole page or reporting zero bytes used — a zero would read as "you have
   * used nothing", which is a claim we cannot make. The plan-change BLOCK
   * inverts this deliberately and refuses instead; see `PlanChangeGuard.verify`
   * for why the two must not agree.
   */
  async getUsage(
    context: RequestContext,
  ): Promise<OrganizationUsageResponseDto> {
    const [usage, storage] = await Promise.all([
      this.organizationsGrpcClient.getUsage(context),
      this.storageLeg(context),
    ]);

    return toOrganizationUsageResponseDto(usage, storage);
  }

  /**
   * Ingestion's tenant-scoped usage read, or the reason it did not answer.
   *
   * `GetStorageUsage` takes no organization id — it is scoped from the caller
   * context — so this cannot ask about another tenant even by mistake.
   */
  private async storageLeg(
    context: RequestContext,
  ): Promise<StorageUsageResponse | null> {
    try {
      return await this.documentsGrpcClient.storageUsage(context);
    } catch (error) {
      this.logger.warn(
        `Storage usage is unavailable for the usage page: ${formatErrorMsg(error)}`,
      );

      return null;
    }
  }

  async getOnboarding(context: RequestContext): Promise<OnboardingResponseDto> {
    return toOnboardingResponseDto(
      await this.organizationsGrpcClient.getOnboarding(context),
    );
  }

  async completeOnboarding(
    context: RequestContext,
  ): Promise<OrganizationResponseDto> {
    return toOrganizationResponseDto(
      await this.organizationsGrpcClient.completeOnboarding(context),
    );
  }

  requestOffboard(
    dto: DeleteOrganizationDto,
    context: RequestContext,
  ): Promise<OffboardResponseDto> {
    return this.organizationsGrpcClient.requestOffboard(dto.reason, context);
  }
}
