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
import { DocumentsService } from './documents.service';
import {
  DocumentResponseGqlDto,
  DocumentPageResponseGqlDto,
} from './dto/graphql/document-response.gql-dto';
import { UserSummaryResponseGqlDto } from '../users/dto/graphql/user-response.gql-dto';
import { DepartmentResponseGqlDto } from '../departments/dto/graphql/department-response.gql-dto';
import { PageArgsGqlDto } from '../../common/dto/graphql/page-args.gql-dto';
import { toPageQuery } from '../../common/graphql/page-query';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { MAX_EDGE_LIST } from '../../common/config/graphql-limits.config';

/**
 * `Query.document` and the document edges
 *
 * The department boundary is ingestion-service's, applied inside the same call
 * the REST route makes: a document scoped to a department is invisible outside
 * it, and this resolver re-implements none of that.
 */
@Resolver(() => DocumentResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DocumentsResolver {
  constructor(private readonly documents: DocumentsService) {}

  @Query(() => DocumentResponseGqlDto, {
    nullable: true,
    description:
      'One document. Null when it does not exist, or is scoped to a ' +
      'department the caller is not in — deliberately indistinguishable.',
  })
  @RequirePermission('document.read')
  async document(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<DocumentResponseGqlDto | null> {
    try {
      return await this.documents.get(id, context);
    } catch {
      return null;
    }
  }

  @Query(() => DocumentPageResponseGqlDto, {
    // **Named explicitly**, because the METHOD cannot be called `documents`:
    // the constructor property already is, and a class cannot have both. The
    // schema must not inherit that collision — `documents_` would be the field
    // name a client sees.
    name: 'documents',
    description: 'Documents visible to the caller.',
  })
  @RequirePermission('document.read')
  async documentPage(
    @Args() args: PageArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<DocumentPageResponseGqlDto> {
    return await this.documents.list(
      {
        ...toPageQuery(args),

        // Not negotiable from this surface, the same rule `users.resolver.ts`
        // states: the REST route gates `includeDeleted` on `document.delete`
        // inside the controller, and re-deriving that check in a resolver would
        // be a second implementation of a permission rule.
        includeDeleted: false,
      },
      context,
    );
  }

  /** `Document.createdBy` — the uploader. */
  @ResolveField(() => UserSummaryResponseGqlDto, {
    nullable: true,
    description: 'Who uploaded this document.',
  })
  async createdBy(
    @Parent() document: DocumentResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<UserSummaryResponseGqlDto | null> {
    if (!document.createdById) return null;

    return await loaders.users.load(document.createdById);
  }

  /**
   * The flat count beside the capped edge. See
   * `UsersResolver.departmentCount` for why it is a field rather than a
   * `totalCount` on the connection.
   */
  @ResolveField(() => Int, {
    description:
      'How many departments this document is scoped to. The `departments` ' +
      `edge is capped at ${MAX_EDGE_LIST}; this is the true total.`,
  })
  departmentCount(@Parent() document: DocumentResponseGqlDto): number {
    // No `?? 0`: `departmentIds` is a declared, required field on the type,
    // so the fallback can only fire on a shape the compiler rejects — and a
    // count that answers 0 for a parent it could not read is the same silent
    // default `User.departments` was fixed for.
    return document.departmentIds.length;
  }

  /**
   * `Document.departments` — the resolved scope.
   *
   * `departmentIds` stays flat beside it, so a client that only needs the ids
   * pays nothing.
   */
  @ResolveField(() => [DepartmentResponseGqlDto], {
    description:
      'The departments this document is scoped to. Empty when it is ' +
      'organization-wide.',
  })
  async departments(
    @Parent() document: DocumentResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<DepartmentResponseGqlDto[]> {
    const ids = document.departmentIds;
    if (ids.length === 0) return [];

    // Sliced BEFORE the batch, same reasoning as
    // `User.departments`: the batch RPC's cap is an error, not a truncation, so
    // an uncapped parent fails the whole field rather than shortening it.
    const departments = await loaders.departments.loadMany(
      ids.slice(0, MAX_EDGE_LIST),
    );

    return departments.filter(
      (department): department is DepartmentResponseGqlDto =>
        department !== null && !(department instanceof Error),
    );
  }
}
