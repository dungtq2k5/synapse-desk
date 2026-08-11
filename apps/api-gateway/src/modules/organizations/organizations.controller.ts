import { Cacheable } from '../../common/decorators/cacheable.decorator';
import { InvalidateCache } from '../../common/decorators/invalidate-cache.decorator';
import { CACHE_SCOPES } from '../../common/config/cache.config';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { OrgAccess, RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { OrganizationsGrpcClient } from './organizations-grpc.client';
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
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';

/**
 * The caller's OWN tenant (api-endpoints-plan).
 *
 * Every route is `/organizations/current` — there is no `/organizations/:id`
 * here at all, which is the structural reason a tenant admin cannot reach
 * another workspace. Cross-tenant access is the platform API's job.
 *
 * A Super Admin has NO current organization, so these return 412 for them
 * rather than a confusing 404; the service raises it.
 */
@ApiTags('Organizations')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('organizations/current')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsGrpcClient: OrganizationsGrpcClient,
  ) {}

  /**
   * NO permission requirement, unlike everything else here.
   *
   * Every member needs the workspace name and status to render the app shell,
   * and the End User role holds zero permission rows by design — so gating this
   * on `organization.read` (as it first was) 403s the first screen for every
   * ordinary member. Authentication plus tenancy IS the authorization: the
   * response is the caller's own workspace and contains no per-member data.
   */
  @OrgAccessKind(OrgAccess.BILLING)
  @ApiOperation({ summary: 'Tenant profile + status + quotas' })
  @ApiWrappedResponse(OrganizationResponseDto)
  @ApiFilterErrors(['401'])
  @Cacheable({
    scope: CACHE_SCOPES.organizations,
    ttlSeconds: 60,
    varyBy: 'tenant',
  })
  @Get()
  get(
    @CurrentUser() context: RequestContext,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsGrpcClient.getCurrent(context);
  }

  /** `slug` changes break existing links; `domain` is security-relevant. */
  @ApiOperation({ summary: 'Update' })
  @ApiWrappedResponse(OrganizationResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @InvalidateCache(CACHE_SCOPES.organizations)
  @Patch()
  @RequirePermission('organization.update')
  update(
    @CurrentUser() context: RequestContext,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsGrpcClient.update(updateOrganizationDto, context);
  }

  @ApiOperation({
    summary: 'Security governance: enforce_two_factor, allowed_email_domains',
  })
  @ApiWrappedResponse(OrganizationSettingsResponseDto)
  @ApiFilterErrors(['401', '403'])
  @Get('settings')
  @RequirePermission('organization.read')
  getSettings(
    @CurrentUser() context: RequestContext,
  ): Promise<OrganizationSettingsResponseDto> {
    return this.organizationsGrpcClient.getSettings(context);
  }

  /**
   * Turning `enforceTwoFactor` on does NOT retroactively enrol anyone — it
   * changes what the next login demands, and members without a second factor
   * get an enrolment challenge rather than a code prompt.
   *
   * Accepted free-mail domains come back as `publicDomainWarnings` and are
   * surfaced as a response warning: letting `gmail.com` auto-join a tenant is
   * usually a mistake, but not one we can safely refuse on the admin's behalf.
   */
  @ApiOperation({ summary: 'Update settings' })
  @ApiWrappedResponse(OrganizationSettingsResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @InvalidateCache(CACHE_SCOPES.organizations)
  @Patch('settings')
  @RequirePermission('organization.update')
  @ResponseMessage('Settings updated')
  async updateSettings(
    @CurrentUser() context: RequestContext,
    @Body() updateOrganizationSettingsDto: UpdateOrganizationSettingsDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationSettingsResponseDto> {
    const settings = await this.organizationsGrpcClient.updateSettings(
      updateOrganizationSettingsDto,
      context,
    );

    if (settings.publicDomainWarnings.length > 0) {
      response.locals.warning =
        `Anyone with an address at ${settings.publicDomainWarnings.join(', ')} ` +
        `can now join this workspace automatically.`;
    }

    return settings;
  }

  /** Storage and AI meters report `available: false` until those domains exist. */
  @OrgAccessKind(OrgAccess.BILLING)
  @ApiOperation({
    summary:
      'Live meters: seats used/max, storage used/max, AI tokens used/budget, billing_cycle_start',
  })
  @ApiWrappedResponse(OrganizationUsageResponseDto)
  @ApiFilterErrors(['401', '403'])
  @Get('usage')
  @RequirePermission('organization.read')
  getUsage(
    @CurrentUser() context: RequestContext,
  ): Promise<OrganizationUsageResponseDto> {
    return this.organizationsGrpcClient.getUsage(context);
  }

  /** Derived live from the data — never a stored checklist. */
  @OrgAccessKind(OrgAccess.ONBOARDING)
  @ApiOperation({
    summary:
      'Onboarding checklist state (departments created, first doc indexed, agents invited)',
  })
  @ApiWrappedResponse(OnboardingResponseDto)
  @ApiFilterErrors(['401', '403'])
  @Get('onboarding')
  @RequirePermission('organization.read')
  getOnboarding(
    @CurrentUser() context: RequestContext,
  ): Promise<OnboardingResponseDto> {
    return this.organizationsGrpcClient.getOnboarding(context);
  }

  /** PENDING_ONBOARDING -> ACTIVE only. 409 from any other status. */
  @OrgAccessKind(OrgAccess.ONBOARDING)
  @ApiOperation({ summary: 'Complete onboarding' })
  @ApiWrappedResponse(OrganizationResponseDto)
  @ApiFilterErrors(['401', '403'])
  @InvalidateCache(CACHE_SCOPES.organizations)
  @Post('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('organization.update')
  @ResponseMessage('Onboarding complete')
  completeOnboarding(
    @CurrentUser() context: RequestContext,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsGrpcClient.completeOnboarding(context);
  }

  /**
   * REQUESTS offboarding: freezes the tenant and signs everyone out now.
   *
   * Not the irreversible part — a Super Admin finalises that. Self-service
   * tenant deletion with no cooling-off is a support incident waiting to
   * happen, and the audit row is what the platform acts on.
   *
   * The caller is signed out too, so their cookies are cleared: they have just
   * revoked their own access along with everyone else's.
   */
  @ApiOperation({ summary: 'Request offboard' })
  @ApiWrappedResponse(OffboardResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @InvalidateCache(CACHE_SCOPES.organizations)
  @Delete()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('organization.delete')
  @ResponseMessage('Offboarding requested')
  async requestOffboard(
    @CurrentUser() context: RequestContext,
    @Body() deleteOrganizationDto: DeleteOrganizationDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OffboardResponseDto> {
    const result = await this.organizationsGrpcClient.requestOffboard(
      deleteOrganizationDto,
      context,
    );

    response.locals.warning =
      'This workspace is frozen pending review. Contact support to cancel.';

    return result;
  }
}
