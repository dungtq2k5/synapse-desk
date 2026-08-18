import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import type { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DepartmentsService } from './departments.service';
import {
  DepartmentResponseGqlDto,
  DepartmentPageResponseGqlDto,
} from './dto/graphql/department-response.gql-dto';
import { PageArgsGqlDto } from '../../common/dto/graphql/page-args.gql-dto';
import { toPageQuery } from '../../common/graphql/page-query';

/** `Query.departments`. */
@Resolver(() => DepartmentResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DepartmentsResolver {
  constructor(private readonly departments: DepartmentsService) {}

  @Query(() => DepartmentPageResponseGqlDto, {
    name: 'departments',
    description: 'Departments in the caller’s tenant.',
  })
  @RequirePermission('department.read')
  async departmentPage(
    @Args() args: PageArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<DepartmentPageResponseGqlDto> {
    return await this.departments.list(
      {
        // `name` rather than the shared `createdAt` default: a department list
        // is read as a picker, and alphabetical is what a picker wants. Both
        // are in `DEPARTMENT_SORTABLE_FIELDS`, so this is a product choice
        // rather than a constraint.
        ...toPageQuery(args, 'name'),

        // **Never deleted departments, and not negotiable from here** — the
        // same rule `TicketsArgsGqlDto` states for its own `includeDeleted`. The REST
        // route accepts the flag and gates it on `department.delete` inside the
        // controller; reproducing that check in a resolver would be a second
        // implementation of a permission rule, so the flag is not
        // offered on this surface and the safe value is passed explicitly.
        //
        // It was previously omitted entirely and the call cast with `as never`,
        // which silenced the missing-property error rather than answering it.
        includeDeleted: false,
      },
      context,
    );
  }
}
