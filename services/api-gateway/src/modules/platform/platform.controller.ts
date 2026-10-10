import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { OrganizationStatusService } from '../../common/organization-status/organization-status.service';
import { PlatformService } from './platform.service';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import {
  CreateGlobalRoleDto,
  CreatePlatformOrganizationDto,
  ListPlatformOrganizationsQueryDto,
  ListPlatformUsersQueryDto,
  OffboardOrganizationDto,
  ResetBillingCycleDto,
  RoleResponseDto,
  SetOrganizationStatusDto,
  UpdatePlatformOrganizationDto,
  ApplyPlanQueryDto,
  CreatePlanDto,
  ListPlansQueryDto,
  UpdatePlanDto,
  FinanceEventsQueryDto,
} from './dto/rest/platform.dto';
import {
  CreatePlatformOrganizationResponseDto,
  OffboardResponseDto,
  PlatformMetricsResponseDto,
  PlatformOrganizationResponseDto,
  PlatformUserResponseDto,
  ApplyPlanResponseDto,
  DeletePlanResponseDto,
  SubscriptionPlanResponseDto,
} from './dto/rest/platform-response.dto';
import {
  BillingEventsResponseDto,
  FinanceSnapshotResponseDto,
} from './dto/rest/finance-response.dto';

/**
 * Platform administration (api-endpoints-plan).
 *
 * `SuperAdminGuard` is applied at CLASS level, never per method. One forgotten
 * decorator on a route here is a full cross-tenant breach, and a class-level
 * guard covers routes added later by default — which is the failure that
 * actually happens.
 *
 * The tenant lifecycle interceptor lets these through automatically: a Super
 * Admin has no organization, and acting on frozen tenants is the entire job.
 */
@ApiTags('Platform')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('platform')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly organizationStatus: OrganizationStatusService,
  ) {}

  // ---------------------------------------------------------------- Tenants

  @ApiOperation({ summary: 'All tenants, filter by status' })
  @ApiWrappedResponse(Paginated(PlatformOrganizationResponseDto))
  @ApiFilterErrors(['401'])
  @Get('organizations')
  listOrganizations(
    @CurrentUser() context: RequestContext,
    @Query() query: ListPlatformOrganizationsQueryDto,
  ): Promise<PaginationResponseDto<PlatformOrganizationResponseDto>> {
    return this.platform.listOrganizations(query, context);
  }

  /** Tenant + its first Org Admin, in one transaction. Half of it is useless. */
  @ApiOperation({ summary: 'Create organization' })
  @ApiWrappedResponse(CreatePlatformOrganizationResponseDto, {
    status: HttpStatus.CREATED,
  })
  @ApiFilterErrors(['400', '401'])
  @Post('organizations')
  createOrganization(
    @CurrentUser() context: RequestContext,
    @Body() createPlatformOrganizationDto: CreatePlatformOrganizationDto,
  ): Promise<CreatePlatformOrganizationResponseDto> {
    return this.platform.createOrganization(
      createPlatformOrganizationDto,
      context,
    );
  }

  @ApiOperation({ summary: 'Tenant detail + usage rollups' })
  @ApiWrappedResponse(PlatformOrganizationResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get('organizations/:id')
  getOrganization(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformOrganizationResponseDto> {
    return this.platform.getOrganization(id, context);
  }

  /** Unlike the tenant-facing PATCH, this may change quotas. */
  @ApiOperation({ summary: 'Update organization' })
  @ApiWrappedResponse(PlatformOrganizationResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Patch('organizations/:id')
  async updateOrganization(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePlatformOrganizationDto: UpdatePlatformOrganizationDto,
  ): Promise<PlatformOrganizationResponseDto> {
    const result = await this.platform.updateOrganization(
      id,
      updatePlatformOrganizationDto,
      context,
    );
    await this.organizationStatus.invalidate(id);

    return result;
  }

  /**
   * The lifecycle machine. Legal transitions only; anything else is a 409.
   *
   * The cached status is dropped immediately afterwards. Without that, a freeze
   * would not take effect for up to the cache TTL — precisely the wrong
   * direction for the one action an operator takes when something is going
   * wrong right now.
   */
  @ApiOperation({ summary: 'Set status' })
  @ApiWrappedResponse(PlatformOrganizationResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post('organizations/:id/status')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Status updated')
  async setStatus(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() setOrganizationStatusDto: SetOrganizationStatusDto,
  ): Promise<PlatformOrganizationResponseDto> {
    const result = await this.platform.setStatus(
      id,
      setOrganizationStatusDto,
      context,
    );
    await this.organizationStatus.invalidate(id);

    return result;
  }

  /**
   * Rolls the metering window. **BREAK-GLASS, not routine**.
   *
   * Two things happen that the response cannot show. `billing_cycle_start` now
   * follows Stripe's `current_period_start`, so a manual roll desynchronizes
   * the quota window from the invoice period; and the cycle epoch is inside
   * the Redis quota key, so it also zeroes AI spend and re-arms every
   * threshold alert — a silent budget grant.
   *
   * Kept because it is genuinely needed to make a tenant whole after an
   * incident. The mandatory reason and the audit row are what separate that
   * from someone using it as a way to sell an upgrade.
   */
  @ApiOperation({ summary: 'Reset billing cycle' })
  @ApiWrappedResponse(PlatformOrganizationResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post('organizations/:id/billing-cycle/reset')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(
    'Billing cycle reset — this desynchronizes the quota window from the Stripe invoice period and grants a fresh AI budget',
  )
  resetBillingCycle(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetBillingCycleDto,
  ): Promise<PlatformOrganizationResponseDto> {
    return this.platform.resetBillingCycle(id, dto.reason, context);
  }

  /** The irreversible half that `DELETE /organizations/current` only requests. */
  @ApiOperation({ summary: 'Offboard' })
  @ApiWrappedResponse(OffboardResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Delete('organizations/:id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Workspace offboarded')
  async offboard(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() offboardOrganizationDto: OffboardOrganizationDto,
  ): Promise<OffboardResponseDto> {
    const result = await this.platform.offboard(
      id,
      offboardOrganizationDto,
      context,
    );
    await this.organizationStatus.invalidate(id);

    return result;
  }

  @ApiOperation({ summary: 'Restore' })
  @ApiWrappedResponse(PlatformOrganizationResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post('organizations/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Workspace restored')
  async restore(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformOrganizationResponseDto> {
    const result = await this.platform.restore(id, context);
    await this.organizationStatus.invalidate(id);

    return result;
  }

  // ---------------------------------------------------------------- Cross-tenant

  /** Every row carries its tenant — a bare address list is how support acts on
   * the wrong account, since one address may legitimately exist in several. */
  @ApiOperation({ summary: 'Cross-tenant user search (support escalations)' })
  @ApiWrappedResponse(Paginated(PlatformUserResponseDto))
  @ApiFilterErrors(['401'])
  @Get('users')
  listUsers(
    @CurrentUser() context: RequestContext,
    @Query() query: ListPlatformUsersQueryDto,
  ): Promise<PaginationResponseDto<PlatformUserResponseDto>> {
    return this.platform.listUsers(query, context);
  }

  @ApiOperation({ summary: 'Manage global system roles' })
  @ApiWrappedResponse(Paginated(RoleResponseDto))
  @ApiFilterErrors(['401'])
  @Get('roles')
  listGlobalRoles(
    @CurrentUser() context: RequestContext,
    @Query() query: ListPlatformUsersQueryDto,
  ): Promise<PaginationResponseDto<RoleResponseDto>> {
    return this.platform.listGlobalRoles(query, context);
  }

  /** A role visible in EVERY tenant, which is why only the platform mints one. */
  @ApiOperation({ summary: 'Create global role' })
  @ApiWrappedResponse(RoleResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401'])
  @Post('roles')
  createGlobalRole(
    @CurrentUser() context: RequestContext,
    @Body() createGlobalRoleDto: CreateGlobalRoleDto,
  ): Promise<RoleResponseDto> {
    return this.platform.createGlobalRole(createGlobalRoleDto, context);
  }

  // ---------------------------------------------------------------- The plan catalogue

  @ApiOperation({ summary: 'The plan catalogue' })
  @ApiWrappedResponse(Paginated(SubscriptionPlanResponseDto))
  @ApiFilterErrors(['401'])
  @Get('plans')
  listPlans(
    @CurrentUser() context: RequestContext,
    @Query() query: ListPlansQueryDto,
  ): Promise<PaginationResponseDto<SubscriptionPlanResponseDto>> {
    return this.platform.listPlans(query, context);
  }

  @ApiOperation({ summary: 'Create a plan' })
  @ApiWrappedResponse(SubscriptionPlanResponseDto, {
    status: HttpStatus.CREATED,
  })
  @ApiFilterErrors(['400', '401'])
  @Post('plans')
  createPlan(
    @CurrentUser() context: RequestContext,
    @Body() createPlanDto: CreatePlanDto,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.platform.createPlan(createPlanDto, context);
  }

  @ApiOperation({
    summary: 'Plan detail, with its prices and subscriber count',
  })
  @ApiWrappedResponse(SubscriptionPlanResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get('plans/:id')
  getPlan(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.platform.getPlan(id, context);
  }

  /**
   * Edits the catalogue row and NOTHING else.
   *
   * Existing subscribers keep what they have until `POST plans/:id/apply`. A
   * silent fan-out on save would rewrite two hundred tenants' entitlements from
   * a form submit.
   */
  @ApiOperation({ summary: 'Update a plan (does NOT change subscribers)' })
  @ApiWrappedResponse(SubscriptionPlanResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Patch('plans/:id')
  updatePlan(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePlanDto: UpdatePlanDto,
  ): Promise<SubscriptionPlanResponseDto> {
    return this.platform.updatePlan(id, updatePlanDto, context);
  }

  /** Refused while anyone is on it — deactivate instead. */
  @ApiOperation({ summary: 'Retire a plan' })
  @ApiWrappedResponse(DeletePlanResponseDto)
  @ApiFilterErrors(['400', '401', '404', '409'])
  @Delete('plans/:id')
  deletePlan(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeletePlanResponseDto> {
    return this.platform.deletePlan(id, context);
  }

  /**
   * Writes the plan's grants onto every subscriber — or projects it.
   *
   * `?dryRun=true` writes nothing and returns the same per-subscriber
   * projection the apply would act on, computed by the same pass. That is the
   * blast radius, and seeing it is the point of making this a separate call.
   */
  @ApiOperation({ summary: 'Apply a plan to its subscribers (or dry-run it)' })
  @ApiWrappedResponse(ApplyPlanResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post('plans/:id/apply')
  @HttpCode(HttpStatus.OK)
  applyPlan(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ApplyPlanQueryDto,
  ): Promise<ApplyPlanResponseDto> {
    return this.platform.applyPlan(id, query.dryRun ?? false, context);
  }

  /** Full-table counts — cached by the client, never joined into a hot path. */
  @ApiOperation({
    summary: 'Platform-wide health: tenant count, MRR-ish usage, AI spend',
  })
  @ApiWrappedResponse(PlatformMetricsResponseDto)
  @ApiFilterErrors(['401'])
  @Get('metrics')
  getMetrics(
    @CurrentUser() context: RequestContext,
  ): Promise<PlatformMetricsResponseDto> {
    return this.platform.getMetrics(context);
  }

  // ---------------------------------------------------------------- Finance

  /**
   * The finance snapshot: plan mix, dunning, and the revenue estimate.
   *
   * **Not folded into `/platform/metrics`, and not one route with the series.**
   * `metrics` answers from auth's own tables and cannot fail; this has a
   * Stripe-fed section that can. Merging them would let a Stripe outage take
   * down the tenancy dashboard.
   *
   * The revenue section degrades with a reason rather than failing the call —
   * three of its four sections are local and exact, and a missing estimate must
   * not cost them.
   */
  @ApiOperation({
    summary: 'Plan mix, dunning, and an estimated MRR — revenue may degrade',
  })
  @ApiWrappedResponse(FinanceSnapshotResponseDto)
  @ApiFilterErrors(['401'])
  @Get('finance')
  getFinanceSnapshot(
    @CurrentUser() context: RequestContext,
  ): Promise<FinanceSnapshotResponseDto> {
    return this.platform.getFinanceSnapshot(context);
  }

  /**
   * The event series — new subscriptions, cancellations, failed payments.
   *
   * **Entirely local, and therefore always answerable**, which is the point of
   * splitting it from the snapshot: it still works during the outage that
   * degrades the other one, and that is exactly when somebody looks.
   *
   * Counts, never amounts. A failed-payment count is a fact about events we
   * received; a failed-payment sum is a claim about money that Stripe will
   * contradict — retries repeat the invoice, and a retry that later succeeds
   * leaves its failure row in place.
   */
  @ApiOperation({ summary: 'Billing events per day, by type. Counts only' })
  @ApiWrappedResponse(BillingEventsResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Get('finance/events')
  listBillingEvents(
    @CurrentUser() context: RequestContext,
    @Query() query: FinanceEventsQueryDto,
  ): Promise<BillingEventsResponseDto> {
    return this.platform.listBillingEvents(query, context);
  }
}
