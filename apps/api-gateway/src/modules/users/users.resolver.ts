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
import { UserServiceGrpcClient } from './users-service-grpc.client';
import { UserResponseGqlDto } from './dto/graphql/user-response.gql-dto';
import { DepartmentResponseGqlDto } from '../departments/dto/graphql/department-response.gql-dto';
import { UserPageGqlDto } from './dto/graphql/user-page.gql-dto';
import { PageArgsGqlDto } from '../../common/dto/graphql/page-args.gql-dto';
import { toPageQuery } from '../../common/mappers/pagination.mapper';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { toDepartmentResponseGqlDto } from '../departments/department.mapper';
import { toUserResponseGqlDto } from './user.mapper';
import { MAX_EDGE_LIST } from '../../common/config/graphql-limits.config';

/**
 * `Query.me`, `Query.user` — 26-doc §4.
 *
 * **`Query.user` carries `@RequirePermission('user.read')`, and `Ticket.assignee`
 * does not** — 25-doc §4, and that is the entire reason the two return different
 * types. The full `User` is reachable only through a query that applies the same
 * check the REST route applies; an edge reaches `UserSummary`, which has no
 * contact details to protect.
 */
@Resolver(() => UserResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersResolver {
  constructor(private readonly users: UserServiceGrpcClient) {}

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
    return toUserResponseGqlDto(
      await this.users.getCurrentUser(context.sub, context),
    );
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
      return toUserResponseGqlDto(await this.users.get(id, context));
    } catch {
      // `null` rather than an error, for the same reason as `Query.ticket`: a
      // non-null field that throws takes the whole query's data with it.
      return null;
    }
  }

  @Query(() => UserPageGqlDto, {
    name: 'users',
    description:
      'Users in the tenant. Requires `user.read`, like `GET /users`. The ' +
      'rows are summaries, not full profiles — the same narrowing the REST ' +
      'list applies.',
  })
  @RequirePermission('user.read')
  async userPage(
    @Args() args: PageArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<UserPageGqlDto> {
    // Both casts here were hiding the same envelope mismatch as `Query.user`,
    // one level deeper: every ROW was a `UserSummaryResponseDto`, so each item
    // in the page failed `User.id` and took the whole query's data with it.
    const page = await this.users.list(
      {
        ...toPageQuery(args),

        // **Never deleted users, and not negotiable from here** — the same rule
        // `TicketsArgsGqlDto` and `DepartmentsResolver` state. The REST route
        // accepts the flag and gates it on `user.delete` inside the controller;
        // reproducing that check in a resolver would be a second implementation
        // of a permission rule (26-doc §4), so it is not offered on this surface
        // and the safe value is passed explicitly.
        //
        // `as never` on the query was previously silencing its absence.
        includeDeleted: false,
      },
      context,
    );

    return {
      // An arrow rather than `.map(toUserResponseGqlDto)`: `map` passes the index as a
      // second argument, and a mapper that later grows an optional parameter
      // would start receiving it silently.
      items: page.items.map((summary) => toUserResponseGqlDto(summary)),
      meta: page.meta,
    };
  }

  /**
   * **The flat count beside the capped edge** — 26-doc §3.2.
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
    // The plain parent type, and no `?? 0`. Both were left over from when
    // `departmentIds` was a property the schema did not declare: the parameter
    // was widened with `& { departmentIds?: string[] }` in order to see it, and
    // the fallback covered its absence. The field is declared and required now,
    // so the widening asserted the OPPOSITE of the class and the fallback could
    // only fire on a shape the compiler already rejects.
    //
    // Leaving them would matter more than it reads: `departments` directly below
    // takes the plain type and reads the field outright, so two resolvers over
    // the SAME parent disagreed about whether it can be missing — and the one
    // that tolerated absence answered `0` rather than failing, which is exactly
    // how `me { departments }` returned an empty list for every caller.
    return user.departmentIds.length;
  }

  /**
   * `User.departments` — 26-doc §3.
   *
   * On `UserResponseGqlDto` rather than `UserSummaryGqlDto`: department membership is
   * organisational information, and an edge that reached it from a ticket would
   * tell a customer which teams an agent belongs to.
   */
  @ResolveField(() => [DepartmentResponseGqlDto], {
    description: 'Departments this user belongs to.',
  })
  async departments(
    @Parent() user: UserResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<DepartmentResponseGqlDto[]> {
    // `user.departmentIds`, plainly. This read used to be
    // `user.departmentIds ?? []` against a parent typed
    // `UserResponseGqlDto & { departmentIds?: string[] }` — an optional field
    // widened onto the parameter because the schema type did not declare it.
    // The `??` then turned "the resolver forgot to carry the ids" into an empty
    // list, which is what let `Query.me` return no departments for every caller
    // without anything failing. The field is declared now, so its absence is a
    // type error rather than a default.
    const ids = user.departmentIds;
    if (ids.length === 0) return [];

    // **Sliced BEFORE the batch, not after** — 26-doc §3.2. A user in 250
    // departments produces a 250-key batch, and `ListDepartmentsByIds` caps at
    // 200 with an ERROR rather than a truncation (27-doc §1, property 5) — so
    // an uncapped parent does not return fewer departments, it fails the whole
    // field. `departmentCount` beside this edge is what tells a client the list
    // was cut.
    const departments = await loaders.departments.loadMany(
      ids.slice(0, MAX_EDGE_LIST),
    );

    return departments
      .map((department) =>
        department instanceof Error
          ? null
          : toDepartmentResponseGqlDto(department),
      )
      .filter(
        (department): department is DepartmentResponseGqlDto =>
          department !== null,
      );
  }
}
