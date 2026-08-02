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
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { RolesGrpcClient } from './roles-grpc.client';
import {
  CreateRoleDto,
  ListRolesQueryDto,
  RoleResponseDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/rest/role.dto';

/**
 * Roles (api-endpoints-plan §1.7).
 *
 * A tenant sees its own roles plus the four global system roles, and may modify
 * none of the latter — enforced in auth-service, not just greyed out here. A
 * UI-only guard would be bypassed by anyone with curl.
 */
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesGrpcClient: RolesGrpcClient) {}

  @Get()
  @RequirePermission('role.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListRolesQueryDto,
  ): Promise<PaginationResponseBase<RoleResponseDto>> {
    return this.rolesGrpcClient.list(query, context);
  }

  @Get(':id')
  @RequirePermission('role.read')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleResponseDto> {
    return this.rolesGrpcClient.get(id, context);
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
  @Post()
  @RequirePermission('role.create')
  create(
    @CurrentUser() context: RequestContext,
    @Body() createRoleDto: CreateRoleDto,
  ): Promise<RoleResponseDto> {
    return this.rolesGrpcClient.create(createRoleDto, context);
  }

  /** 403 on a system role. */
  @Patch(':id')
  @RequirePermission('role.update')
  update(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    return this.rolesGrpcClient.update(id, updateRoleDto, context);
  }

  /** 409 while any user still holds it — roles are hard-deleted and cascade. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('role.delete')
  @ResponseMessage('Role deleted')
  remove(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.rolesGrpcClient.remove(id, context);
  }

  /**
   * PUT, not PATCH: replace semantics, so retrying is safe and a code left out
   * of the body is genuinely revoked.
   */
  @Put(':id/permissions')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('role.permission.assign')
  @ResponseMessage('Permissions updated')
  setPermissions(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() setRolePermissionsDto: SetRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    return this.rolesGrpcClient.setPermissions(
      id,
      setRolePermissionsDto,
      context,
    );
  }
}
