import { Field, ObjectType } from '@nestjs/graphql';
import { TicketResponseGqlDto } from './ticket-response.gql-dto';

/**
 * **Mutations return a payload type; queries return the entity directly** —
 * 25-doc §3.
 *
 * The convention earns its place twice over. It gives a mutation somewhere to
 * put the `message` the REST envelope carries — which GraphQL has no envelope
 * for — and somewhere to add `userErrors` later without a breaking change.
 *
 * Queries get nothing extra: a query that failed is an error, and Apollo
 * already says so in `errors[]`.
 */
@ObjectType('TicketMutationPayload')
export class TicketMutationPayloadGqlDto {
  /** The ticket as it now stands, so the client re-renders from the response. */
  @Field(() => TicketResponseGqlDto)
  ticket!: TicketResponseGqlDto;

  /**
   * What the REST envelope would have carried in `message`.
   *
   * Nullable because most mutations have nothing to say beyond the entity —
   * and a field that is always present and usually empty trains clients to
   * ignore it.
   */
  @Field(() => String, { nullable: true })
  message?: string | null;
}
