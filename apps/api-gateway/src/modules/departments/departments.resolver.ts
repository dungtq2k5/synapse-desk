import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import type { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DepartmentsGrpcClient } from './departments-grpc.client';
import { DepartmentResponseGqlDto } from './dto/graphql/department-response.gql-dto';
import { DepartmentPageGqlDto } from './dto/graphql/department-page.gql-dto';
import { PageArgsGqlDto } from '../../common/dto/graphql/page-args.gql-dto';
import { toPageQuery } from '../../common/mappers/pagination.mapper';

/** `Query.departments` — 26-doc §4. */
@Resolver(() => DepartmentResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DepartmentsResolver {
  constructor(private readonly client: DepartmentsGrpcClient) {}

  @Query(() => DepartmentPageGqlDto, {
    name: 'departments',
    description: 'Departments in the caller’s tenant.',
  })
  @RequirePermission('department.read')
  async departmentPage(
    @Args() args: PageArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<DepartmentPageGqlDto> {
    return await this.client.list(
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
        // implementation of a permission rule (26-doc §4), so the flag is not
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
