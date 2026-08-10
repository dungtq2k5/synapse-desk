import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import '../../../../common/graphql/enums';

/**
 * A ticket, as the GraphQL schema serves it — 26-doc §2, §3.
 *
 * **Independent of `TicketResponseDto`.** The two are checked against each other
 * by `ticket-response.contract.spec.ts` rather than coupled by inheritance —
 * which is what the previous `TicketType extends TicketResponseDto` tried to
 * achieve and did not: a field added to the parent was inherited, typed, and
 * absent from the schema, with the compiler silent and every test passing.
 *
 * **Every `@Field()` names its GraphQL type explicitly.** TypeScript's `number`
 * cannot distinguish `Int` from `Float`, nor `string` an `ID` from a `String`,
 * so an inferred choice is wrong about half the time in a way no test notices —
 * both serialise identically until a client generates types from the SDL.
 *
 * **`nullable` mirrors the REST DTO's `| null`.** They drift silently: a field
 * becomes nullable there, stays non-null here, and the first null row fails the
 * WHOLE query with a non-null error rather than returning one null field. The
 * contract spec checks the pairing.
 *
 * **`currentAssigneeId` stays flat, beside the `assignee` edge** — 26-doc §3. A
 * client that only wants the id must not pay a network call for it, and
 * `assignee { id }` would.
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
