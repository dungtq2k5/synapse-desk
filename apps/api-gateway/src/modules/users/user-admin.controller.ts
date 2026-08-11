import {
  InvalidateCache,
  entityFromParam,
} from '../../common/decorators/invalidate-cache.decorator';
import { CACHE_SCOPES } from '../../common/config/cache.config';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { UserServiceGrpcClient } from './users-service-grpc.client';
import { UpdateUserDto } from './dto/rest/update-user.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import {
  CreateUserDto,
  ListUsersQueryDto,
  LockUserDto,
  RevokedSessionCountDto,
  SetUserDepartmentsDto,
  SetUserRolesDto,
  UntrustedDeviceCountDto,
  UserPermissionsResponseDto,
  UserSummaryResponseDto,
} from './dto/rest/user-admin.dto';

/**
 * Tenant administration of OTHER users (api-endpoints-plan).
 *
 * Every route is permission-gated and every query is tenant-scoped in
 * auth-service — a user id from another tenant 404s, never 403, because
 * "you may not see this" confirms the row exists.
 *
 * Registered AFTER UsersController so `/users/me` wins over `/users/:id`.
 */
@ApiTags('User Admin')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UserAdminController {
  constructor(private readonly usersGrpcClient: UserServiceGrpcClient) {}

  @ApiOperation({ summary: 'List tenant users' })
  @ApiWrappedResponse(Paginated(UserSummaryResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get()
  @RequirePermission('user.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginationResponseDto<UserSummaryResponseDto>> {
    // Deactivated accounts need the module's MANAGE permission, not its read
    // one. Checked here rather than with a second @RequirePermission because
    // that decorator is ANY, so adding a code would WIDEN the route instead of
    // narrowing it.
    if (
      query.includeDeleted &&
      !context.permissionCodes.includes('user.delete')
    ) {
      throw new ForbiddenException(
        'Viewing deactivated users requires the user.delete permission',
      );
    }

    return this.usersGrpcClient.list(query, context);
  }

  @ApiOperation({ summary: 'Detail + roles + departments' })
  @ApiWrappedResponse(UserSummaryResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id')
  @RequirePermission('user.read')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserSummaryResponseDto> {
    return this.usersGrpcClient.get(id, context);
  }

  /**
   * The flattened union across the user's roles — computed by the same function
   * that builds the JWT claim, so this and the token cannot disagree.
   */
  @ApiOperation({
    summary: 'Flattened effective permission codes (role union)',
  })
  @ApiWrappedResponse(UserPermissionsResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id/permissions')
  @RequirePermission('user.read')
  async getPermissions(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserPermissionsResponseDto> {
    return {
      permissionCodes: await this.usersGrpcClient.getPermissions(id, context),
    };
  }

  /**
   * Direct creation, for seeding and service accounts. The account gets NO
   * password — prefer `POST /users/invitations` for humans, which mails a token
   * instead of requiring one to be handed over out of band.
   */
  @ApiOperation({ summary: 'Create' })
  @ApiWrappedResponse(UserSummaryResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401', '403'])
  @Post()
  @RequirePermission('user.create')
  create(
    @CurrentUser() context: RequestContext,
    @Body() createUserDto: CreateUserDto,
  ): Promise<UserSummaryResponseDto> {
    return this.usersGrpcClient.create(createUserDto, context);
  }

  @ApiOperation({ summary: 'Update' })
  @ApiWrappedResponse(UserSummaryResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.users, entityFromParam('user'))
  @Patch(':id')
  @RequirePermission('user.update')
  update(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserSummaryResponseDto> {
    return this.usersGrpcClient.update(id, updateUserDto, context);
  }

  /**
   * Deactivate: soft delete AND revoke every session, so access stops now
   * rather than whenever the access token happens to expire.
   *
   * 409 on self, and on the last active Org Admin.
   */
  @ApiOperation({ summary: 'Remove' })
  @ApiWrappedResponse(RevokedSessionCountDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.delete')
  @ResponseMessage('User deactivated')
  remove(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RevokedSessionCountDto> {
    return this.usersGrpcClient.remove(id, context);
  }

  /** 409 if the address was taken while the account was deactivated. */
  @ApiOperation({ summary: 'Restore' })
  @ApiWrappedResponse(UserSummaryResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.delete')
  @ResponseMessage('User restored')
  restore(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserSummaryResponseDto> {
    return this.usersGrpcClient.restore(id, context);
  }

  /** Same self / last-admin guards as delete, and the same session revocation. */
  @ApiOperation({ summary: 'Lock' })
  @ApiWrappedResponse(RevokedSessionCountDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.lock')
  @ResponseMessage('User locked')
  lock(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() lockUserDto: LockUserDto,
  ): Promise<RevokedSessionCountDto> {
    return this.usersGrpcClient.lock(id, lockUserDto, context);
  }

  /** No sessions restored: unlocking permits signing in, it does not sign in. */
  @ApiOperation({ summary: 'Unlock' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.lock')
  @ResponseMessage('User unlocked')
  unlock(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.usersGrpcClient.unlock(id, context);
  }

  /**
   * For the user who lost their authenticator. REMOVES a security control, so
   * it is audited, the user is emailed, and every trusted device is dropped
   * with it — otherwise the lost device keeps bypassing 2FA that no longer
   * exists.
   */
  @ApiOperation({ summary: 'Reset two factor' })
  @ApiWrappedResponse(UntrustedDeviceCountDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post(':id/2fa/reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.2fa.reset')
  @ResponseMessage('Two-factor authentication reset')
  resetTwoFactor(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UntrustedDeviceCountDto> {
    return this.usersGrpcClient.resetTwoFactor(id, context);
  }

  /**
   * PUT: replace semantics, safe to retry. The no-escalation rule applies in
   * the service — an actor may not grant a role carrying permissions they do
   * not themselves hold, or `user.role.assign` would be equivalent to full
   * tenant control.
   */
  @ApiOperation({ summary: 'Set roles' })
  @ApiWrappedResponse(UserSummaryResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Put(':id/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.role.assign')
  @ResponseMessage('Roles updated')
  setRoles(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() setUserRolesDto: SetUserRolesDto,
  ): Promise<UserSummaryResponseDto> {
    return this.usersGrpcClient.setRoles(id, setUserRolesDto, context);
  }

  /** Exactly one entry must be primary when the list is non-empty. */
  @ApiOperation({ summary: 'Set departments' })
  @ApiWrappedResponse(UserSummaryResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Put(':id/departments')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('department.member.assign')
  @ResponseMessage('Departments updated')
  setDepartments(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() setUserDepartmentsDto: SetUserDepartmentsDto,
  ): Promise<UserSummaryResponseDto> {
    return this.usersGrpcClient.setDepartments(
      id,
      setUserDepartmentsDto,
      context,
    );
  }
}
