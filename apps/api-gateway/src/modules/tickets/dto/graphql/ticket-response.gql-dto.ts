import { PageMetaResponseGqlDto } from '../../../../common/dto/graphql/page-meta-response.gql-dto';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import '../../../../common/graphql/enums';

/**
 * A ticket, as the GraphQL schema serves it.
 *
 * **Independent of `TicketResponseDto`**, checked against it by
 * `ticket-response.contract.spec.ts` rather than coupled by inheritance.
 *
 * **Every `@Field()` names its GraphQL type explicitly** — TypeScript's
 * `number` cannot distinguish `Int` from `Float`, and both serialize
 * identically until a client generates types from the SDL.
 *
 * **`nullable` mirrors the REST DTO's `| null`.** They drift silently: a field
 * becomes nullable there, stays non-null here, and the first null row fails the
 * WHOLE query rather than returning one null field.
 *
 * **`currentAssigneeId` stays flat, beside the `assignee` edge.** A client that
 * only wants the id must not pay a network call for it, and `assignee { id }`
 * would.
 *
 * See `docs/decisions/0014-narrow-graphql-edge-types.md`.
 */
@ObjectType('Ticket', {
  description:
    'A support ticket. Reads are narrowed by ticket-service to what the ' +
    'caller authored or is assigned, unless they hold `ticket.read.all`.',
})
export class TicketResponseGqlDto {
  @Field(() => ID)
  id!: string;

  /** Per-tenant sequential number, shown to users as "#1042". */
  @Field(() => Int)
  ticketNumber!: number;

  @Field(() => ID)
  organizationId!: string;

  @Field(() => ID)
  authorId!: string;

  @Field(() => TicketSource, { nullable: true })
  source!: TicketSource | null;

  @Field(() => TicketStatus, { nullable: true })
  status!: TicketStatus | null;

  @Field(() => TicketPriority, { nullable: true })
  priority!: TicketPriority | null;

  @Field(() => String)
  title!: string;

  @Field(() => String)
  description!: string;

  /**
   * The assignee's id, WITHOUT resolving them.
   *
   * Kept alongside the `assignee` edge on purpose — see the class note.
   */
  @Field(() => ID, { nullable: true })
  currentAssigneeId!: string | null;

  @Field(() => ID, { nullable: true })
  currentDepartmentId!: string | null;

  @Field(() => Date, { nullable: true })
  escalatedAt!: Date | null;

  @Field(() => Date, { nullable: true })
  resolvedAt!: Date | null;

  /**
   * Messages the caller has not read here — theirs excluded, notes they cannot
   * see excluded, a ticket never opened counting as ALL unread.
   *
   * **Always 0 on `ticket(id:)`** — only the list fills it in, because a badge
   * is a list affordance and a caller who fetched one ticket is reading it.
   * Querying it on a single ticket returns a constant, not a stale number.
   *
   * On the schema rather than REST-only: a badge is what a client renders on a
   * queue, and a GraphQL client renders queues too. `Int` because the count is
   * bounded by one ticket's thread.
   */
  @Field(() => Int)
  unreadCount!: number;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  /**
   * Set when the ticket is soft-deleted.
   *
   * Exposed rather than hidden: a client that can see a deleted row needs to
   * know it is deleted, and inferring that from absence is what makes a UI
   * render a blank where "Deleted" belongs.
   */
  @Field(() => Date, { nullable: true })
  deletedAt!: Date | null;

  @Field(() => ID, { nullable: true })
  deletedById!: string | null;
}

/**
 * A page of tickets.
 *
 * GraphQL-only: REST returns its own envelope, so there is nothing for the base
 * class to share here. Lives beside the ticket it pages rather than in a file
 * that also held `UserPage`, `DocumentPage`, `NotificationFeed` and
 * `DepartmentPage` — which is what `ticket-page.type.ts` had become, a name that
 * had stopped describing four of the five types in it.
 */
@ObjectType('TicketPage')
export class TicketPageResponseGqlDto {
  @Field(() => [TicketResponseGqlDto])
  items!: TicketResponseGqlDto[];

  @Field(() => PageMetaResponseGqlDto)
  meta!: PageMetaResponseGqlDto;
}

/**
 * **Mutations return a payload type; queries return the entity directly** —
 *
 *
 * The convention earns its place twice over. It gives a mutation somewhere to
 * put the `message` the REST envelope carries — which GraphQL has no envelope
 * for — and somewhere to add `userErrors` later without a breaking change.
 *
 * Queries get nothing extra: a query that failed is an error, and Apollo
 * already says so in `errors[]`.
 */
@ObjectType('TicketMutationPayload')
export class TicketMutationPayloadResponseGqlDto {
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
