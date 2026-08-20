import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import {
  AI_THROTTLER_TIER,
  ROUTE_THROTTLE,
} from '../../common/config/throttler.config';
import { AnalyticsExportResponseDto } from '../analytics/dto/rest/analytics-response.dto';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditActionsResponseDto,
  AuditLogResponseDto,
} from './dto/rest/audit-log-response.dto';
import {
  CreateAuditLogExportDto,
  ListAuditLogsQueryDto,
} from './dto/rest/audit-log.dto';
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
  constructor(private readonly auditLogs: AuditLogsService) {}

  @ApiOperation({ summary: 'Tenant-scoped immutable trail' })
  @ApiWrappedResponse(Paginated(AuditLogResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get()
  @RequirePermission('audit.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PaginationResponseDto<AuditLogResponseDto>> {
    return this.auditLogs.list(query, context);
  }

  /**
   * Request a compliance export. **POST, and `202`.**
   *
   * A GET that writes is one a browser prefetch, a link preview or an automatic
   * retry can trigger, and each would produce another file against a tenant's
   * storage. The plan named GET; the shipped analytics export settled this.
   *
   * CSV or `application/json` — `audit_logs.metadata` is genuinely nested and
   * CSV flattens it into one quoted cell, which is the argument for offering
   * JSON here and not on the ticket export.
   *
   * **The request itself is audited**, which closes a circularity: without it
   * the one export whose purpose is compliance was the only act missing from
   * the log it exports.
   */
  @ApiOperation({ summary: 'Request an audit-log export' })
  @ApiWrappedResponse(AnalyticsExportResponseDto, {
    status: HttpStatus.ACCEPTED,
  })
  @ApiFilterErrors(['400', '401', '403'])
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.export })
  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('audit.export')
  createExport(
    @CurrentUser() context: RequestContext,
    @Body() dto: CreateAuditLogExportDto,
  ): Promise<AnalyticsExportResponseDto> {
    return this.auditLogs.createExport(dto, context);
  }

  /** Poll for the file. Another tenant's id answers 404, never 403. */
  @ApiOperation({ summary: 'Get an audit-log export' })
  @ApiWrappedResponse(AnalyticsExportResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get('export/:id')
  @RequirePermission('audit.export')
  getExport(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnalyticsExportResponseDto> {
    return this.auditLogs.getExport(id, context);
  }

  /**
   * Declared BEFORE any `:id` route would be — the ordering hazard that bit
   * `bulk/status`. There is no `:id` route here today; the ordering is
   * stated so adding one later cannot silently swallow this path.
   *
   * Returns only the actions that ACTUALLY occurred for this tenant. Offering
   * the full enum would fill a filter dropdown with options that are guaranteed
   * to return nothing, which trains people to distrust the filter.
   */
  @ApiOperation({ summary: 'Distinct action values, for filter dropdowns' })
  @ApiWrappedResponse(AuditActionsResponseDto)
  @ApiFilterErrors(['401', '403'])
  @Get('actions')
  @RequirePermission('audit.read')
  listActions(
    @CurrentUser() context: RequestContext,
  ): Promise<AuditActionsResponseDto> {
    return this.auditLogs.listActions(context);
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
  constructor(private readonly auditLogs: AuditLogsService) {}

  @ApiOperation({ summary: 'Tenant-scoped immutable trail' })
  @ApiWrappedResponse(Paginated(AuditLogResponseDto))
  @ApiFilterErrors(['401'])
  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PaginationResponseDto<AuditLogResponseDto>> {
    return this.auditLogs.list(query, context, true);
  }

  @ApiOperation({ summary: 'Distinct action values, for filter dropdowns' })
  @ApiWrappedResponse(AuditActionsResponseDto)
  @ApiFilterErrors(['401'])
  @Get('actions')
  listActions(
    @CurrentUser() context: RequestContext,
  ): Promise<AuditActionsResponseDto> {
    return this.auditLogs.listActions(context, true);
  }
}
