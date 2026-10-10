import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { PermissionCode } from '@synapsedesk/common';
import { PageMetaResponseGqlDto } from '../../../../common/dto/graphql/page-meta-response.gql-dto';

/**
 * A tenant role, as the GraphQL schema serves it.
 *
 * The `permissions` edge is why this type is on the schema: `permissionCodes`
 * is a list of codes and nothing else, so a role editor cannot tell a live code
 * from a retired one without fetching the catalogue and joining client-side.
 */
@ObjectType('Role')
export class RoleResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;

  /** Readable by every tenant, mutable by none. */
  @Field(() => Boolean)
  isSystemRole!: boolean;

  /**
   * How many users hold this role.
   *
   * Computed by auth-service for `DELETE /roles/:id`'s guard, so it costs
   * nothing extra here. It is the TRUE total — there is no `users` edge for it
   * to be the length of, and `roles.resolver.ts` records why that edge is
   * deferred.
   */
  @Field(() => Int)
  userAssigned!: number;

  /**
   * The codes themselves, flat beside the `permissions` edge.
   *
   * Same rule as `IngestionJob.documentId`: a client that only needs the codes
   * must not pay a network call for them. `[String!]!` rather than an enum —
   * a retired code is in the table and out of `PERMISSION_CODES` (ADR 0038), so
   * a GraphQL enum would refuse to serialize a value the API legitimately
   * returns.
   */
  @Field(() => [String])
  permissionCodes!: PermissionCode[];

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

/** One entry in the permission catalogue. */
@ObjectType('Permission')
export class PermissionResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  code!: PermissionCode;

  @Field(() => String)
  name!: string;

  /** The `target` prefix of the code, for grouping in the role editor. */
  @Field(() => String)
  group!: string;

  /**
   * True when the code is in the table and no longer in `PERMISSION_CODES`.
   *
   * **This field is the reason the `permissions` edge exists.** Retired rather
   * than deleted, because roles may still hold it (ADR 0038); an editor should
   * show it as ungrantable rather than as an option, and with only
   * `permissionCodes` it cannot tell the difference.
   */
  @Field(() => Boolean)
  isRetired!: boolean;
}

/** A page of tenant roles. */
@ObjectType('RolePage')
export class RolePageResponseGqlDto {
  @Field(() => [RoleResponseGqlDto])
  items!: RoleResponseGqlDto[];

  @Field(() => PageMetaResponseGqlDto)
  meta!: PageMetaResponseGqlDto;
}
