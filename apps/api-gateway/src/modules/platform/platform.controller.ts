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
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { OrganizationStatusService } from '../../common/services/organization-status.service';
import { PlatformGrpcClient } from './platform-grpc.client';
import {
  CreateGlobalRoleDto,
  CreatePlatformOrganizationDto,
  CreatePlatformOrganizationResponseDto,
  ListPlatformOrganizationsQueryDto,
  ListPlatformUsersQueryDto,
  OffboardOrganizationDto,
  OffboardResponseDto,
  PlatformMetricsResponseDto,
  PlatformOrganizationResponseDto,
  PlatformUserResponseDto,
  RoleResponseDto,
  SetOrganizationStatusDto,
  UpdatePlatformOrganizationDto,
} from './dto/rest/platform.dto';

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
@Controller('platform')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlatformController {
  constructor(
    private readonly platformGrpcClient: PlatformGrpcClient,
    private readonly organizationStatus: OrganizationStatusService,
  ) {}

  // -------------------------------------------------------------------------
  // Tenants
  // -------------------------------------------------------------------------

  @Get('organizations')
  listOrganizations(
    @CurrentUser() context: RequestContext,
    @Query() query: ListPlatformOrganizationsQueryDto,
  ): Promise<PaginationResponseBase<PlatformOrganizationResponseDto>> {
    return this.platformGrpcClient.listOrganizations(query, context);
  }

  /** Tenant + its first Org Admin, in one transaction. Half of it is useless. */
  @Post('organizations')
  createOrganization(
    @CurrentUser() context: RequestContext,
    @Body() createPlatformOrganizationDto: CreatePlatformOrganizationDto,
  ): Promise<CreatePlatformOrganizationResponseDto> {
    return this.platformGrpcClient.createOrganization(
      createPlatformOrganizationDto,
      context,
    );
  }

  @Get('organizations/:id')
  getOrganization(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformOrganizationResponseDto> {
    return this.platformGrpcClient.getOrganization(id, context);
  }

  /** Unlike the tenant-facing PATCH, this may change quotas. */
  @Patch('organizations/:id')
  async updateOrganization(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePlatformOrganizationDto: UpdatePlatformOrganizationDto,
  ): Promise<PlatformOrganizationResponseDto> {
    const result = await this.platformGrpcClient.updateOrganization(
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
  @Post('organizations/:id/status')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Status updated')
  async setStatus(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() setOrganizationStatusDto: SetOrganizationStatusDto,
  ): Promise<PlatformOrganizationResponseDto> {
    const result = await this.platformGrpcClient.setStatus(
      id,
      setOrganizationStatusDto,
      context,
    );
    await this.organizationStatus.invalidate(id);

    return result;
  }

  /** Rolls the metering window — AI usage is counted from this instant. */
  @Post('organizations/:id/billing-cycle/reset')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Billing cycle reset')
  resetBillingCycle(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformOrganizationResponseDto> {
    return this.platformGrpcClient.resetBillingCycle(id, context);
  }

  /** The irreversible half that `DELETE /organizations/current` only requests. */
  @Delete('organizations/:id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Workspace offboarded')
  async offboard(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() offboardOrganizationDto: OffboardOrganizationDto,
  ): Promise<OffboardResponseDto> {
    const result = await this.platformGrpcClient.offboard(
      id,
      offboardOrganizationDto,
      context,
    );
    await this.organizationStatus.invalidate(id);

    return result;
  }

  @Post('organizations/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Workspace restored')
  async restore(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlatformOrganizationResponseDto> {
    const result = await this.platformGrpcClient.restore(id, context);
    await this.organizationStatus.invalidate(id);

    return result;
  }

  // -------------------------------------------------------------------------
  // Cross-tenant
  // -------------------------------------------------------------------------

  /** Every row carries its tenant — a bare address list is how support acts on
   * the wrong account, since one address may legitimately exist in several. */
  @Get('users')
  listUsers(
    @CurrentUser() context: RequestContext,
    @Query() query: ListPlatformUsersQueryDto,
  ): Promise<PaginationResponseBase<PlatformUserResponseDto>> {
    return this.platformGrpcClient.listUsers(query, context);
  }

  @Get('roles')
  listGlobalRoles(
    @CurrentUser() context: RequestContext,
    @Query() query: ListPlatformUsersQueryDto,
  ): Promise<PaginationResponseBase<RoleResponseDto>> {
    return this.platformGrpcClient.listGlobalRoles(query, context);
  }

  /** A role visible in EVERY tenant, which is why only the platform mints one. */
  @Post('roles')
  createGlobalRole(
    @CurrentUser() context: RequestContext,
    @Body() createGlobalRoleDto: CreateGlobalRoleDto,
  ): Promise<RoleResponseDto> {
    return this.platformGrpcClient.createGlobalRole(
      createGlobalRoleDto,
      context,
    );
  }

  /** Full-table counts — cached by the client, never joined into a hot path. */
  @Get('metrics')
  getMetrics(
    @CurrentUser() context: RequestContext,
  ): Promise<PlatformMetricsResponseDto> {
    return this.platformGrpcClient.getMetrics(context);
  }
}
