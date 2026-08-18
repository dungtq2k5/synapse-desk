import { PageMetaResponseGqlDto } from '../../../../common/dto/graphql/page-meta-response.gql-dto';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Gender } from '@synapsedesk/common';
import '../../../../common/graphql/enums';

/**
 * The FULL user, as the GraphQL schema serves it.
 *
 * **Reachable only from `Query.user` and `Query.me`, never from an edge.** It
 * carries `email`, `phoneNumber` and `lastLoginAt`; `UserSummaryResponseGqlDto` carries
 * a name and an avatar. That split is the security model — the fields are not
 * in the reachable type, so no query can ask for them:
 *
 * ```graphql
 * query { ticket(id: "…") { assignee { email } } }   # cannot be written
 * ```
 *
 * **Independent of `UserResponseDto`.** `user-response.contract.spec.ts`
 * asserts the field sets agree, so the duplication is checked rather than
 * trusted. No `class-validator` here: validators run on the way IN, and this
 * type is only ever written OUT.
 *
 * **Every `@Field()` names its GraphQL type explicitly** — TypeScript's
 * `number` cannot distinguish `Int` from `Float`, and both serialize
 * identically until a client generates types from the SDL.
 *
 * See `docs/decisions/0014-narrow-graphql-edge-types.md`.
 */
@ObjectType('User', {
  description:
    'A user in full, including contact details. Reachable only from ' +
    '`Query.user` / `Query.me`, both behind the same permission the REST ' +
    'routes apply — edges expose `UserSummary` instead.',
})
export class UserResponseGqlDto {
  @Field(() => ID)
  readonly id!: string;

  /** null for platform Super Admins, who belong to no tenant (RDM). */
  @Field(() => ID, { nullable: true })
  readonly organizationId!: string | null;

  /**
   * The ids, flat. The resolved departments are the `departments` edge.
   *
   * **Exposed for the reason every other type here exposes its ids**
   * the same rule behind `Ticket.currentAssigneeId`, `Document.departmentIds`
   * and `Notification.actorId`: a client that only wants the ids must not pay a
   * network call for them, and `departments { id }` would.
   *
   * `User` was the one type that broke that rule, and the cost was not just
   * inconsistency. The ids arrive on the envelope `UserServiceGrpcClient`
   * returns, so the `departments` resolver needs them on the parent — which
   * meant carrying them as a property the schema did not declare, invisible to
   * every client and to anyone reading this class. Declaring the field makes the
   * carrier the contract: `toUserResponseGqlDto` now returns exactly this type, with
   * nothing extra riding along.
   *
   * No new exposure: `departments { id }` already answers this, behind the same
   * `user.read` that guards the whole type.
   */
  @Field(() => [ID])
  readonly departmentIds!: string[];

  @Field(() => String)
  readonly fullName!: string;

  @Field(() => String, { nullable: true })
  readonly avatarUrl!: string | null;

  @Field(() => String)
  readonly email!: string;

  @Field(() => Boolean)
  readonly isEmailVerified!: boolean;

  @Field(() => String, { nullable: true })
  readonly phoneNumber!: string | null;

  @Field(() => Boolean)
  readonly isPhoneVerified!: boolean;

  /**
   * ISO 'YYYY-MM-DD' — a calendar date with no time and no zone.
   *
   * `String` rather than `DateTime` for that reason: `DateTime` would invite a
   * client to parse it as an instant, and a birthday would shift a day
   * depending on the reader's offset.
   */
  @Field(() => String, { nullable: true })
  readonly dob!: string | null;

  @Field(() => Gender)
  readonly gender!: Gender;

  @Field(() => Date, { nullable: true })
  readonly lastLoginAt!: Date | null;

  @Field(() => Boolean)
  readonly isLocked!: boolean;

  /**
   * When a temporary lock lapses; `null` means INDEFINITE.
   *
   * `isLocked` stays the field a client renders on. This is here so an admin
   * screen can say "locked until Friday" instead of just "locked".
   */
  @Field(() => Date, { nullable: true })
  readonly lockedUntil!: Date | null;

  @Field(() => Boolean)
  readonly isTwoFactorEnabled!: boolean;

  @Field(() => Date)
  readonly createdAt!: Date;

  @Field(() => Date)
  readonly updatedAt!: Date;
}

/** A page of users, from `Query.users` — behind `user.read`, like the REST list. */
@ObjectType('UserPage')
export class UserPageResponseGqlDto {
  @Field(() => [UserResponseGqlDto])
  items!: UserResponseGqlDto[];

  @Field(() => PageMetaResponseGqlDto)
  meta!: PageMetaResponseGqlDto;
}

/**
 * What an EDGE is allowed to see of a user.
 *
 * The narrow type IS the security model. GraphQL authorizes nothing by default,
 * so a caller holding ticket access but no `user.read` could otherwise compose
 * their way to an agent's email and login history:
 *
 * ```graphql
 * query { ticket(id: "…") { assignee { email phoneNumber lastLoginAt } } }
 * ```
 *
 * Those fields are not in this type, so no query can reach them. The wide
 * `User` is reachable only from `Query.user`, behind the same `user.read` check
 * the REST route applies.
 *
 * Enforced at the wire too: `ListUsersByIds`'s summary projection never sends an
 * address, so this is not a mapper that must remember to drop one.
 *
 * **No contract test**, deliberately — there is no narrow-user REST response to
 * agree with, because REST has no traversal to narrow.
 *
 * See `docs/decisions/0014-narrow-graphql-edge-types.md`.
 */
@ObjectType('UserSummary', {
  description:
    'A user as seen through an edge — name and avatar only. Reachable with ' +
    'whatever permission the edge itself required; `User` and its contact ' +
    'details are behind `Query.user` and `user.read`.',
})
export class UserSummaryResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  fullName!: string;

  @Field(() => String, { nullable: true })
  avatarUrl!: string | null;

  /**
   * Whether this account is locked.
   *
   * Carried so a client can render "Former employee" rather than infer it from
   * an absence — which it cannot distinguish from a row that never existed.
   */
  @Field(() => Boolean)
  isLocked!: boolean;

  /** Set when the account was soft-deleted. Same reasoning as `isLocked`. */
  @Field(() => Date, { nullable: true })
  deletedAt!: Date | null;
}
