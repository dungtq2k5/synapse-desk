import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * What an EDGE is allowed to see of a user
 *
 * **The narrow type is the security model, not a convenience.** GraphQL
 * authorizes nothing by default, so composition defeats route-level
 * permissions:
 *
 * ```graphql
 * query { ticket(id: "…") { assignee { email phoneNumber lastLoginAt } } }
 * ```
 *
 * A caller with ticket access and NO `user.read` would come away holding an
 * agent's email, phone number and login history — assembled out of two
 * permissions, neither of which grants it. The permission system stays intact
 * and the composition walks around it.
 *
 * Two ways to close that, and the difference matters:
 *
 *   - **Guard every field.** Procedural. Correct when applied, and the failure
 *     mode is forgetting one on a type with thirty fields — invisible, and only
 *     in the composition nobody tried.
 *   - **A narrower type at the edge.** Structural. The fields are not in the
 *     schema, so no query can reach them.
 *
 * This is the second. `User` — with `email`, `phoneNumber`, `lastLoginAt` — is
 * reachable only from `Query.user`, behind the same `user.read` check the REST
 * route applies. The rule generalises: *a type reached by traversal exposes only
 * what the traversal's own permission justifies.*
 *
 * Enforced at the WIRE too: `ListUsersByIds`'s summary projection does not send
 * an address at all, so this is not a mapper that must remember to drop one.
 *
 * **GraphQL-only, with no REST counterpart.** There is no narrow-user REST
 * response, because REST has no traversal to narrow — every route that returns
 * a user already checked `user.read`. So this type has no contract test: there
 * is nothing on the other side to agree with.
 */
@ObjectType('UserSummary', {
  description:
    'A user as seen through an edge — name and avatar only. Reachable with ' +
    'whatever permission the edge itself required; `User` and its contact ' +
    'details are behind `Query.user` and `user.read`.',
})
export class UserSummaryGqlDto {
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
