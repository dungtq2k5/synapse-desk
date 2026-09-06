import {
  Int,
  Args,
  Context,
  ID,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import {
  UserResponseGqlDto,
  UserPageResponseGqlDto,
} from './dto/graphql/user-response.gql-dto';
import { DepartmentResponseGqlDto } from '../departments/dto/graphql/department-response.gql-dto';
import { SearchPageArgsGqlDto } from '../../common/dto/graphql/page-args.gql-dto';
import { toPageQuery } from '../../common/graphql/page-query';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { MAX_EDGE_LIST } from '../../common/config/graphql-limits.config';

/**
 * `Query.me`, `Query.user`.
 *
 * **`Query.user` carries `@RequirePermission('user.read')`, and `Ticket.assignee`
 * does not**, and that is the entire reason the two return different
 * types. The full `User` is reachable only through a query that applies the same
 * check the REST route applies; an edge reaches `UserSummary`, which has no
 * contact details to protect.
 */
@Resolver(() => UserResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersResolver {
  constructor(private readonly users: UsersService) {}

  /**
   * The caller themselves. No `user.read`, deliberately.
   *
   * Reading your own profile is not an administrative act — the REST route
   * makes the same distinction, and requiring the permission here would mean a
   * user needed a grant to see their own name.
   */
  @Query(() => UserResponseGqlDto, {
    nullable: true,
    description: 'The authenticated caller. Requires no permission.',
  })
  async me(
    @CurrentUser() context: RequestContext,
  ): Promise<UserResponseGqlDto | null> {
    // Mapped, not `current.user`. That read the right half and dropped the
    // other: `departmentIds` is a SIBLING of `user` on the envelope, so `me`
    // rendered correctly while `me { departments }` returned `[]` for every
    // caller — the quiet version of the bug `Query.user` had loudly.
    return await this.users.getCurrentUserGql(context.sub, context);
  }

  @Query(() => UserResponseGqlDto, {
    nullable: true,
    description:
      'One user in full, including contact details. Requires `user.read` — ' +
      'the same check `GET /users/:id` applies. Edges expose `UserSummary`.',
  })
  @RequirePermission('user.read')
  async user(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<UserResponseGqlDto | null> {
    try {
      // `get()` answers a `UserSummaryResponseDto` — the user NESTED under
      // `.user`, beside `roleIds` and `departmentIds`. Returning that envelope
      // through `as unknown as UserResponseGqlDto` left every declared field
      // `undefined`, so this query answered `Cannot return null for
      // non-nullable field User.id` to every caller that reached it.
      return await this.users.getGql(id, context);
    } catch {
      // `null` rather than an error, for the same reason as `Query.ticket`: a
      // non-null field that throws takes the whole query's data with it.
      return null;
    }
  }

  @Query(() => UserPageResponseGqlDto, {
    name: 'users',
    description:
      'Users in the tenant. Requires `user.read`, like `GET /users`. The ' +
      'rows are summaries, not full profiles — the same narrowing the REST ' +
      'list applies.',
  })
  @RequirePermission('user.read')
  async userPage(
    @Args() args: SearchPageArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<UserPageResponseGqlDto> {
    // Both casts here were hiding the same envelope mismatch as `Query.user`,
    // one level deeper: every ROW was a `UserSummaryResponseDto`, so each item
    // in the page failed `User.id` and took the whole query's data with it.
    const page = await this.users.listGql(
      {
        ...toPageQuery(args),

        // **Never deleted users, and not negotiable from here** — the same rule
        // `TicketsArgsGqlDto` and `DepartmentsResolver` state. The REST route
        // accepts the flag and gates it on `user.delete` inside the controller;
        // reproducing that check in a resolver would be a second implementation
        // of a permission rule, so it is not offered on this surface
        // and the safe value is passed explicitly.
        //
        // `as never` on the query was previously silencing its absence.
        includeDeleted: false,
      },
      context,
    );

    return page;
  }

  /**
   * **The flat count beside the capped edge**.
   *
   * Without it a capped list is indistinguishable from a complete one: a client
   * showing fifty departments cannot tell whether that is all of them, and the
   * cap becomes a silent truncation of exactly the kind the batch RPC refuses
   * to perform.
   *
   * A field rather than `departments { totalCount }`, for the same reason
   * `Ticket.messageCount` is: the number is already on the parent, and
   * resolving it through the edge would fetch rows in order to count them.
   */
  @ResolveField(() => Int, {
    description:
      'How many departments this user belongs to. The `departments` edge is ' +
      `capped at ${MAX_EDGE_LIST}; this is the true total.`,
  })
  departmentCount(@Parent() user: UserResponseGqlDto): number {
    // No `?? 0`: `departmentIds` is declared and required on the parent, so a
    // fallback could only fire on a shape the compiler already rejects -- and
    // one that answered `0` would hide a resolver that forgot to carry the ids.
    return user.departmentIds.length;
  }

  /**
   * `User.departments`.
   *
   * On `UserResponseGqlDto` rather than `UserSummaryResponseGqlDto`: department membership is
   * organizational information, and an edge that reached it from a ticket would
   * tell a customer which teams an agent belongs to.
   */
  @ResolveField(() => [DepartmentResponseGqlDto], {
    description: 'Departments this user belongs to.',
  })
  async departments(
    @Parent() user: UserResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<DepartmentResponseGqlDto[]> {
    // Read plainly, with no `?? []`: the field is declared and required on the
    // parent, so a resolver that failed to carry the ids is a TYPE ERROR rather
    // than an empty list nobody notices.
    const ids = user.departmentIds;
    if (ids.length === 0) return [];

    // **Sliced BEFORE the batch, not after**. A user in 250
    // departments produces a 250-key batch, and `ListDepartmentsByIds` caps at
    // 200 with an ERROR rather than a truncation — so
    // an uncapped parent does not return fewer departments, it fails the whole
    // field. `departmentCount` beside this edge is what tells a client the list
    // was cut.
    const departments = await loaders.departments.loadMany(
      ids.slice(0, MAX_EDGE_LIST),
    );

    return departments.filter(
      (department): department is DepartmentResponseGqlDto =>
        department !== null && !(department instanceof Error),
    );
  }
}
