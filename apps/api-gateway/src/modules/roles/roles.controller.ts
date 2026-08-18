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
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { RolesService } from './roles.service';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import {
  CreateRoleDto,
  ListRolesQueryDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/rest/role.dto';
import { RoleResponseDto } from './dto/rest/role-response.dto';

/**
 * Roles (`api-endpoints-plan.md`).
 *
 * A tenant sees its own roles plus the four global system roles, and may modify
 * none of the latter — enforced in auth-service, not just greyed out here. A
 * UI-only guard would be bypassed by anyone with curl.
 */
@ApiTags('Roles')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @ApiOperation({
    summary:
      'Tenant custom roles + global system roles (organization_id IS NULL)',
  })
  @ApiWrappedResponse(Paginated(RoleResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Cacheable({
    scope: CACHE_SCOPES.roles,
    ttlSeconds: 5 * 60,
    varyBy: 'tenant',
  })
  @Get()
  @RequirePermission('role.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListRolesQueryDto,
  ): Promise<PaginationResponseDto<RoleResponseDto>> {
    return this.roles.list(query, context);
  }

  @ApiOperation({ summary: 'Detail + attached permissions + user_assigned' })
  @ApiWrappedResponse(RoleResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id')
  @RequirePermission('role.read')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleResponseDto> {
    return this.roles.get(id, context);
  }

  /**
   * Always creates a TENANT role, never a global one.
   *
   * Gated on `role.create` ALONE, deliberately. The body also grants
   * permissions, so listing `role.permission.assign` here as well looks like
   * the stricter choice — but `@RequirePermission` is **ANY**, so it would
   * WEAKEN the gate to "either one". The escalation risk is closed in the
   * service instead, by the rule that an actor cannot grant what they do not
   * hold; that check does not care which permission opened the route.
   */
  @ApiOperation({ summary: 'Create' })
  @ApiWrappedResponse(RoleResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401', '403'])
  @InvalidateCache(CACHE_SCOPES.roles)
  @Post()
  @RequirePermission('role.create')
  create(
    @CurrentUser() context: RequestContext,
    @Body() createRoleDto: CreateRoleDto,
  ): Promise<RoleResponseDto> {
    return this.roles.create(createRoleDto, context);
  }

  /** 403 on a system role. */
  @ApiOperation({ summary: 'Update' })
  @ApiWrappedResponse(RoleResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.roles)
  @Patch(':id')
  @RequirePermission('role.update')
  update(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    return this.roles.update(id, updateRoleDto, context);
  }

  /** 409 while any user still holds it — roles are hard-deleted and cascade. */
  @ApiOperation({ summary: 'Remove' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.roles)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('role.delete')
  @ResponseMessage('Role deleted')
  remove(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.roles.remove(id, context);
  }

  /**
   * PUT, not PATCH: replace semantics, so retrying is safe and a code left out
   * of the body is genuinely revoked.
   */
  @ApiOperation({ summary: 'Set permissions' })
  @ApiWrappedResponse(RoleResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.roles)
  @Put(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('role.permission.assign')
  @ResponseMessage('Permissions updated')
  setPermissions(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() setRolePermissionsDto: SetRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    return this.roles.setPermissions(id, setRolePermissionsDto, context);
  }
}
