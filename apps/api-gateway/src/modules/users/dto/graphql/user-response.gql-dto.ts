import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Gender } from '@synapsedesk/common';
import '../../../../common/graphql/enums';

/**
 * The FULL user, as the GraphQL schema serves it
 *
 * **Independent of `UserResponseDto`, deliberately.** The two describe the same
 * domain object and share no class: a DTO is a transport contract, and coupling
 * the two made the REST layer import `@nestjs/graphql` while giving the GraphQL
 * layer no protection it did not already have. `user-response.contract.spec.ts`
 * asserts the field sets agree, so the duplication is checked rather than
 * trusted.
 *
 * **No `class-validator` here, and that is the point of the split.** Validators
 * run on the way IN; this type is only ever written OUT. On the shared class
 * they were dead weight on every response field — carried because the REST half
 * needed them for `PickType`, not because anything here reads them.
 *
 * **Every `@Field()` names its GraphQL type explicitly.** TypeScript's `number`
 * cannot distinguish `Int` from `Float`, nor `string` an `ID` from a `String`,
 * so an inferred choice is wrong about half the time in a way nothing catches —
 * both serialise identically until a client generates types from the SDL.
 *
 * **Reachable only from `Query.user` and `Query.me`, never from an edge.** This
 * carries `email`, `phoneNumber` and `lastLoginAt`; `UserSummaryGqlDto` carries
 * a name and an avatar. That split is the security model:
 *
 * ```graphql
 * query { ticket(id: "…") { assignee { email } } }   # cannot be written
 * ```
 *
 * A caller with ticket access and no `user.read` would otherwise assemble an
 * agent's contact details out of two permissions, neither of which grants them.
 * The fields are not in the reachable type, so no query can ask for them —
 * structural rather than a guard somebody has to remember on all sixteen.
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
   * §3, the same rule behind `Ticket.currentAssigneeId`, `Document.departmentIds`
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
   * When a temporary lock lapses; `null` means INDEFINITE
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
