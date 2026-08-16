import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Which build is answering — the GraphQL twin of `GET /version`.
 *
 * **`@ObjectType('ApiInfo')`, named explicitly.** An unnamed `@ObjectType()`
 * takes the CLASS name, so this type was called `ApiInfo` in the schema only
 * because the class was. Renaming the class to the `…GqlDto` convention would
 * silently have renamed the schema type too — a breaking change to every client,
 * produced by a rename nobody would think to review. The name is now stated,
 * which decouples the SDL from what the class happens to be called.
 *
 * The three fields and no more: adding the environment name or the Node version
 * would reintroduce, on a second transport, exactly what the OpenAPI work kept off the
 * REST one.
 */
@ObjectType('ApiInfo')
export class ApiInfoGqlDto {
  /** Semver of the running build. */
  @Field(() => String)
  version!: string;

  /** The git commit this image was built from. */
  @Field(() => String)
  sha!: string;

  /** ISO 8601, stamped at image build time — not at boot. */
  @Field(() => String)
  builtAt!: string;
}
