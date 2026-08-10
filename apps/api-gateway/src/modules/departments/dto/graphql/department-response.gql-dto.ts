import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * A department, as reached from a ticket, a document or a user.
 *
 * **GraphQL-only, with no REST counterpart to check against.** The REST
 * `DepartmentResponseDto` carries the full administrative row; this is the
 * narrow shape an edge exposes, on the same reasoning as `UserSummaryGqlDto` —
 * a type reached by traversal shows only what the traversal's own permission
 * justifies.
 */
@ObjectType('Department')
export class DepartmentResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;
}
