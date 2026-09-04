import {
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
import { RolesService } from './roles.service';
import {
  PermissionResponseGqlDto,
  RolePageResponseGqlDto,
  RoleResponseGqlDto,
} from './dto/graphql/role-response.gql-dto';
import { PageArgsGqlDto } from '../../common/dto/graphql/page-args.gql-dto';
import { toPageQuery } from '../../common/graphql/page-query';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';

/**
 * `Query.role`, `Query.roles`, `Query.permissions`, and the `permissions` edge.
 *
 * The composition this serves is the role editor: a role and the catalogue it
 * grants from, in one round trip instead of three.
 *
 * **`Role.users` is deliberately absent.** It would need a
 * `ListUsersByRoleIds` rpc that does not exist, against a precedent —
 * `Ticket.messages` — that says not to invent a batch RPC for a query nobody
 * makes in bulk. `userAssigned` is the count, and `GET /users?roleId=` is the
 * list.
 */
@Resolver(() => RoleResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RolesResolver {
  constructor(private readonly roles: RolesService) {}

  @Query(() => RoleResponseGqlDto, {
    nullable: true,
    description:
      'One role. Null when it does not exist in the caller’s tenant — ' +
      'deliberately indistinguishable from a role they cannot see.',
  })
  @RequirePermission('role.read')
  async role(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<RoleResponseGqlDto | null> {
    try {
      return await this.roles.get(id, context);
    } catch {
      return null;
    }
  }

  @Query(() => RolePageResponseGqlDto, {
    // Named explicitly: the method cannot be `roles` while the constructor
    // property is.
    name: 'roles',
    description: 'Roles in the caller’s tenant.',
  })
  @RequirePermission('role.read')
  async rolePage(
    @Args() args: PageArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<RolePageResponseGqlDto> {
    return await this.roles.list(
      {
        ...toPageQuery(args),
        // Matching the REST default rather than the schema's convenience: a
        // caller who wants system roles has to ask, because silently widening a
        // list is the riskier default and the role editor knows which view it
        // wants. Exposing it as an argument would mean a second decision about
        // a default that is already made.
        includeSystem: false,
      },
      context,
    );
  }

  @Query(() => [PermissionResponseGqlDto], {
    name: 'permissions',
    description:
      'The full permission catalogue, including retired codes. Retired ones ' +
      'are still held by roles and can never be granted again (ADR 0038).',
  })
  @RequirePermission('role.read')
  async permissionCatalogue(
    @CurrentUser() context: RequestContext,
    @Context() { loaders }: GqlContext,
  ): Promise<PermissionResponseGqlDto[]> {
    // Through the loader rather than the service, so a query asking for both
    // this and `role { permissions }` fetches the catalogue once.
    return (await loaders.permissions.load(context.organizationId ?? '')) ?? [];
  }

  /**
   * `Role.permissions` — the codes resolved against the catalogue.
   *
   * The edge exists for ONE field: `isRetired`. A role holding a retired code
   * renders identically to one holding a live code when all the client has is
   * `permissionCodes`, and the role editor is exactly the panel that a
   * retired-code fix elsewhere did not reach.
   *
   * Filtered here rather than fetched per role, because the catalogue is one
   * list: the loader makes a page of roles one call, and the filter is a lookup
   * over a few dozen entries.
   */
  @ResolveField(() => [PermissionResponseGqlDto], {
    description:
      'This role’s permissions, resolved against the catalogue so a retired ' +
      'code can be told from a live one. `permissionCodes` is the same set, flat.',
  })
  async permissions(
    @Parent() role: RoleResponseGqlDto,
    @CurrentUser() context: RequestContext,
    @Context() { loaders }: GqlContext,
  ): Promise<PermissionResponseGqlDto[]> {
    // Keyed on the TENANT, not the role: the catalogue is one list per tenant,
    // and every role in a page shares it. Passing the role id would make the
    // loader's memo per-role and reinstate the N calls it exists to collapse.
    const catalogue =
      (await loaders.permissions.load(context.organizationId ?? '')) ?? [];
    const held = new Set<string>(role.permissionCodes);

    return catalogue.filter((permission) => held.has(permission.code));
  }
}
