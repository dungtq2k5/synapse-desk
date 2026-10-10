import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Which build is answering — the GraphQL twin of `GET /version`.
 *
 * **`@ObjectType('Version')`, named explicitly.** An unnamed `@ObjectType()`
 * takes the CLASS name, so renaming the class would silently rename the schema
 * type — a breaking change produced by a refactor nobody would think to review.
 *
 * The three fields and no more: adding the environment name or the Node version
 * would reintroduce, on a second transport, exactly what the OpenAPI work kept off the
 * REST one.
 */
@ObjectType('Version')
export class VersionResponseGqlDto {
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
