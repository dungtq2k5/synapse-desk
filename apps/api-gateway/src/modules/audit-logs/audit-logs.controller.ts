import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { AuditLogsGrpcClient } from './audit-logs-grpc.client';
import { AuditLogResponseDto } from './dto/rest/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/rest/audit-log.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';

/**
 * The tenant's own trail — `audit.read`.
 *
 * READ ONLY, and there is no write route to omit: the proto has no
 * `CreateAuditLog` message, so there is nothing here that could have been
 * exposed. The table is written by one NATS consumer and by nothing else.
 *
 * **Platform rows never appear here.** `organization_id IS NULL` events belong
 * to the platform rather than to any customer, and folding them into a tenant's
 * view would show one customer's admin things that happened to other customers.
 * `/platform/audit-logs` is the separate, Super-Admin-only view — separate
 * CONTROLLER, not a flag on this one, so the scope cannot be reached by
 * guessing a query parameter.
 */
@ApiTags('Audit Logs')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsGrpcClient: AuditLogsGrpcClient) {}

  @ApiOperation({ summary: 'Tenant-scoped immutable trail' })
  @ApiWrappedResponse(Paginated(AuditLogResponseDto))
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Tenant-scoped immutable trail' })
  @ApiWrappedResponse(Paginated(AuditLogResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get()
  @RequirePermission('audit.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PaginationResponseBase<AuditLogResponseDto>> {
    return this.auditLogsGrpcClient.list(query, context);
  }

  /**
   * Declared BEFORE any `:id` route would be — the ordering hazard that bit
   * `bulk/status` in §2.3. There is no `:id` route here today; the ordering is
   * stated so adding one later cannot silently swallow this path.
   *
   * Returns only the actions that ACTUALLY occurred for this tenant. Offering
   * the full enum would fill a filter dropdown with options that are guaranteed
   * to return nothing, which trains people to distrust the filter.
   */
  @ApiOperation({ summary: 'Distinct action values, for filter dropdowns' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Distinct action values, for filter dropdowns' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['401', '403'])
  @Get('actions')
  @RequirePermission('audit.read')
  listActions(@CurrentUser() context: RequestContext): Promise<string[]> {
    return this.auditLogsGrpcClient.listActions(context);
  }
}

/**
 * The PLATFORM trail — Super Admin only, and a different set of rows entirely.
 *
 * A separate controller under a separate prefix rather than `?platform=true` on
 * the route above. Two reasons: the guard is different (`SuperAdminGuard`, not
 * a permission), and a boolean query parameter is exactly the kind of thing
 * that gets forwarded from a copy-pasted URL. Making the scope part of the PATH
 * means a tenant admin cannot reach it by accident or by guess.
 */
@Controller('platform/audit-logs')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlatformAuditLogsController {
  constructor(private readonly auditLogsGrpcClient: AuditLogsGrpcClient) {}

  @ApiOperation({ summary: 'Tenant-scoped immutable trail' })
  @ApiWrappedResponse(Paginated(AuditLogResponseDto))
  @ApiFilterErrors(['401'])
  @ApiOperation({ summary: 'Tenant-scoped immutable trail' })
  @ApiWrappedResponse(Paginated(AuditLogResponseDto))
  @ApiFilterErrors(['401'])
  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PaginationResponseBase<AuditLogResponseDto>> {
    return this.auditLogsGrpcClient.list(query, context, true);
  }

  @ApiOperation({ summary: 'Distinct action values, for filter dropdowns' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['401'])
  @ApiOperation({ summary: 'Distinct action values, for filter dropdowns' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['401'])
  @Get('actions')
  listActions(@CurrentUser() context: RequestContext): Promise<string[]> {
    return this.auditLogsGrpcClient.listActions(context, true);
  }
}
