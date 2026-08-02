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
import { DepartmentsGrpcClient } from './departments-grpc.client';
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
 * Departments (api-endpoints-plan §1.5).
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
@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DepartmentsController {
  constructor(private readonly departmentsGrpcClient: DepartmentsGrpcClient) {}

  @Get()
  @RequirePermission('department.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListDepartmentsQueryDto,
  ): Promise<PaginationResponseBase<DepartmentResponseDto>> {
    // `includeDeleted` needs the module's MANAGE permission, not its read one.
    // Checked here rather than with a second @RequirePermission because that
    // decorator gates the whole route, and gating the route would deny plain
    // reads to everyone without department.delete.
    this.assertMayIncludeDeleted(context, query);

    return this.departmentsGrpcClient.list(query, context);
  }

  @Get(':id')
  @RequirePermission('department.read')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentResponseDto> {
    return this.departmentsGrpcClient.get(id, context);
  }

  @Post()
  @RequirePermission('department.create')
  create(
    @CurrentUser() context: RequestContext,
    @Body() createDepartmentDto: CreateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    return this.departmentsGrpcClient.create(createDepartmentDto, context);
  }

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

  @Get(':id/members')
  @RequirePermission('department.read')
  listMembers(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListDepartmentMembersQueryDto,
  ): Promise<PaginationResponseBase<DepartmentMemberResponseDto>> {
    return this.departmentsGrpcClient.listMembers(id, query, context);
  }

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

  private assertMayIncludeDeleted(
    context: RequestContext,
    query: ListDepartmentsQueryDto,
  ): void {
    if (!query.includeDeleted) return;

    if (!context.permissionCodes.includes('department.delete')) {
      throw new ForbiddenException(
        'Viewing deleted departments requires the department.delete permission',
      );
    }
  }
}
