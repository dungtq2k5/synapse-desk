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
import { OrganizationsService } from './organizations.service';
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
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import { InboundAddressResponseDto } from './dto/rest/inbound-address-response.dto';

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
  constructor(private readonly organizations: OrganizationsService) {}

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
    return this.organizations.getCurrent(context);
  }

  /**
   * Issues the tenant's inbound support address, or ROTATES it.
   *
   * **The same route for both**, because "enable" and "rotate" differ only in
   * whether the tenant already had a token. A separate rotate endpoint would
   * make a client decide which to call, and getting that wrong either fails or
   * silently re-keys a working address.
   *
   * **`organization.update`, not a self-service action.** The token is a
   * ROUTING KEY: rotating it stops the old address delivering immediately, so
   * an end user able to call this could take down their own tenant's support
   * address.
   *
   * **No id in the path**, matching every other route on this controller: the
   * tenant comes from the verified caller, so there is no request shape in
   * which an admin re-keys somebody else's workspace.
   */
  @ApiOperation({ summary: 'Enable or rotate the inbound email address' })
  @ApiWrappedResponse(InboundAddressResponseDto, {
    status: HttpStatus.CREATED,
    description:
      'The new address. Any previous one stops routing immediately — mail ' +
      'already in flight to it is dropped as unroutable, which is the point ' +
      'of a rotation and also its cost.',
  })
  @ApiFilterErrors(['401', '403'])
  @InvalidateCache(CACHE_SCOPES.organizations)
  @Post('inbound-token')
  @RequirePermission('organization.update')
  @HttpCode(HttpStatus.CREATED)
  issueInboundToken(
    @CurrentUser() context: RequestContext,
  ): Promise<InboundAddressResponseDto> {
    return this.organizations.issueInboundToken(context);
  }

  /**
   * Switches inbound email off.
   *
   * Returns the tenant to the state one that never enabled email is already in.
   * Idempotent, because the caller's intent is satisfied either way.
   */
  @ApiOperation({ summary: 'Disable the inbound email address' })
  @ApiWrappedResponse(undefined, {
    status: HttpStatus.NO_CONTENT,
    description: 'Inbound mail is off. The address stops routing immediately.',
  })
  @ApiFilterErrors(['401', '403'])
  @InvalidateCache(CACHE_SCOPES.organizations)
  @Delete('inbound-token')
  @RequirePermission('organization.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInboundToken(@CurrentUser() context: RequestContext): Promise<void> {
    return this.organizations.revokeInboundToken(context);
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
    return this.organizations.update(updateOrganizationDto, context);
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
    return this.organizations.getSettings(context);
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
    const settings = await this.organizations.updateSettings(
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
    return this.organizations.getUsage(context);
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
    return this.organizations.getOnboarding(context);
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
    return this.organizations.completeOnboarding(context);
  }

  /**
   * REQUESTS offboarding: freezes the tenant and signs everyone out now.
   *
   * Not the irreversible part — a Super Admin finalizes that. Self-service
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
    const result = await this.organizations.requestOffboard(
      deleteOrganizationDto,
      context,
    );

    response.locals.warning =
      'This workspace is frozen pending review. Contact support to cancel.';

    return result;
  }
}
