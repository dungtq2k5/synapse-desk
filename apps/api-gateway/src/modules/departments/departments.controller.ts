import { Cacheable } from '../../common/decorators/cacheable.decorator';
import {
  InvalidateCache,
  entityFromParam,
} from '../../common/decorators/invalidate-cache.decorator';
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { QueryPermissionGuard } from '../../common/guards/query-permission.guard';
import { RequirePermissionForQuery } from '../../common/decorators/require-permission-for-query.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { DepartmentsGrpcClient } from './departments-grpc.client';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import {
  AddDepartmentMembersDto,
  AddDepartmentMembersResponseDto,
  CreateDepartmentDto,
  DepartmentMemberResponseDto,
  DepartmentResponseDto,
  ListDepartmentMembersQueryDto,
  ListDepartmentsQueryDto,
  UpdateDepartmentDto,
} from './dto/rest/department.dto';

/**
 * Departments (api-endpoints-plan).
 *
 * The tenant is never a parameter. It travels in the caller's verified context,
 * which `BaseGrpcClient` packs into gRPC metadata — so there is no request in
 * which an admin can name someone else's organization.
 *
 * `JwtAuthGuard` is class-level so a route added later is authenticated by
 * default. `PermissionGuard` reads `@RequirePermission`, which is per-method
 * because reads and writes need different grants.
 *
 * NOT gated on `EmailVerifiedGuard`: unlike invitations, nothing here sends
 * mail on the tenant's behalf, and an admin whose verification mail bounced
 * should still be able to see their own org chart.
 */
@ApiTags('Departments')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionGuard, QueryPermissionGuard)
export class DepartmentsController {
  constructor(private readonly departmentsGrpcClient: DepartmentsGrpcClient) {}

  @ApiOperation({
    summary: 'List departments in tenant (+ member counts, open-ticket counts)',
  })
  @ApiWrappedResponse(Paginated(DepartmentResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Cacheable({
    scope: CACHE_SCOPES.departments,
    ttlSeconds: 5 * 60,
    varyBy: 'tenant',
  })
  @Get()
  @RequirePermission('department.read')
  // `includeDeleted` needs the module's MANAGE permission, not its read one —
  // and a second `@RequirePermission` cannot express that, because it gates the
  // whole route and its semantics are ANY.
  //
  // **In a GUARD rather than in the handler, and that is a fix.**
  // As a handler check it was bypassed entirely by `@Cacheable`: a caller
  // holding `department.delete` warmed `?includeDeleted=true`, and the next
  // caller without it was served that entry with a 200 and never reached the
  // 403. Guards run before interceptors; handlers do not.
  @RequirePermissionForQuery({
    query: 'includeDeleted',
    permission: 'department.delete',
  })
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListDepartmentsQueryDto,
  ): Promise<PaginationResponseDto<DepartmentResponseDto>> {
    return this.departmentsGrpcClient.list(query, context);
  }

  @ApiOperation({ summary: 'Detail' })
  @ApiWrappedResponse(DepartmentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id')
  @RequirePermission('department.read')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentResponseDto> {
    return this.departmentsGrpcClient.get(id, context);
  }

  @ApiOperation({ summary: 'Create' })
  @ApiWrappedResponse(DepartmentResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401', '403'])
  @InvalidateCache(CACHE_SCOPES.departments)
  @Post()
  @RequirePermission('department.create')
  create(
    @CurrentUser() context: RequestContext,
    @Body() createDepartmentDto: CreateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    return this.departmentsGrpcClient.create(createDepartmentDto, context);
  }

  @ApiOperation({ summary: 'Update' })
  @ApiWrappedResponse(DepartmentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.departments, entityFromParam('department'))
  @Patch(':id')
  @RequirePermission('department.update')
  update(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    return this.departmentsGrpcClient.update(id, updateDepartmentDto, context);
  }

  /** Soft delete. 409 while the department still has members. */
  @ApiOperation({ summary: 'Remove' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.departments, entityFromParam('department'))
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('department.delete')
  @ResponseMessage('Department deleted')
  remove(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.departmentsGrpcClient.remove(id, context);
  }

  /** 409 if the name was re-used while this one was deleted. */
  @ApiOperation({ summary: 'Restore' })
  @ApiWrappedResponse(DepartmentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.departments, entityFromParam('department'))
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('department.delete')
  @ResponseMessage('Department restored')
  restore(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentResponseDto> {
    return this.departmentsGrpcClient.restore(id, context);
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  @ApiOperation({
    summary: 'Members (via user_departments), flagging is_primary',
  })
  @ApiWrappedResponse(Paginated(DepartmentMemberResponseDto))
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id/members')
  @RequirePermission('department.read')
  listMembers(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListDepartmentMembersQueryDto,
  ): Promise<PaginationResponseDto<DepartmentMemberResponseDto>> {
    return this.departmentsGrpcClient.listMembers(id, query, context);
  }

  @ApiOperation({ summary: 'Add members' })
  @ApiWrappedResponse(AddDepartmentMembersResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.departments, entityFromParam('department'))
  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('department.member.assign')
  @ResponseMessage('Members assigned')
  addMembers(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() addDepartmentMembersDto: AddDepartmentMembersDto,
  ): Promise<AddDepartmentMembersResponseDto> {
    return this.departmentsGrpcClient.addMembers(
      id,
      addDepartmentMembersDto,
      context,
    );
  }

  /**
   * 409 when this is the user's primary department and they belong to others —
   * the caller must choose the replacement rather than have one picked for
   * them, because primary department drives ticket routing and document scope.
   */
  @ApiOperation({ summary: 'Remove member' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @InvalidateCache(CACHE_SCOPES.departments, entityFromParam('department'))
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('department.member.assign')
  @ResponseMessage('Member removed')
  removeMember(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.departmentsGrpcClient.removeMember(id, userId, context);
  }
}
