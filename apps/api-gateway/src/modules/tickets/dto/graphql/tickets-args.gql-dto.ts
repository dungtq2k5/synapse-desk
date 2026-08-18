import { ArgsType, Field, Int } from '@nestjs/graphql';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import {
  DEFAULT_SEARCH,
  TICKET_SORTABLE_FIELDS,
  TicketPriority,
  TicketSource,
  TicketStatus,
  type TicketSortableField,
} from '@synapsedesk/common';
import { MAX_PAGE_SIZE } from '../../../../common/config/graphql-limits.config';
import '../../../../common/graphql/enums';

/**
 * Arguments for `Query.tickets`
 *
 * **A separate `@ArgsType`, not the REST query DTO.** `@InputType`/`@ArgsType`
 * cannot be the same class as an `@ObjectType`, and more practically the REST
 * DTO extends `SearchPaginationDto` through `OmitType` from **`@nestjs/swagger`**
 * — which produces a class with no GraphQL metadata at all, so the arguments
 * would appear in the schema with zero fields and nothing would error at build
 * time. That trap is a known footnote, and it is why this is written out
 * rather than derived.
 *
 * The class-validator decorators are kept so the same rules apply on both
 * transports: Nest's global `ValidationPipe` runs for resolver arguments too.
 */
@ArgsType()
export class TicketsArgsGqlDto {
  @Field(() => Int, { defaultValue: DEFAULT_SEARCH.PAGE })
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = DEFAULT_SEARCH.PAGE;

  /**
   * How many tickets to return.
   *
   * **Clamped server-side to {@link MAX_PAGE_SIZE}, not rejected**.
   * An unbounded list multiplies every nested field beneath it, but rejecting
   * `first: 500` makes the cap a breaking change for a client that worked
   * yesterday. Clamping keeps them working with less data than they asked for,
   * which is the failure mode a client can actually handle.
   *
   * `@Max` is deliberately absent for that reason: a validator here would turn
   * the clamp into the rejection it is meant to replace. The clamp lives in the
   * resolver.
   */
  @Field(() => Int, { defaultValue: DEFAULT_SEARCH.LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  first: number = DEFAULT_SEARCH.LIMIT;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(TICKET_SORTABLE_FIELDS)
  sortBy?: TicketSortableField;

  @Field(() => TicketStatus, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(TicketStatus))
  status?: TicketStatus;

  @Field(() => TicketPriority, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(TicketPriority))
  priority?: TicketPriority;

  @Field(() => TicketSource, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(TicketSource))
  source?: TicketSource;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  assigneeId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  authorId?: string;

  /**
   * Deliberately ABSENT: `includeDeleted`.
   *
   * The REST route accepts it and gates it on `ticket.delete`, checked inside
   * the controller rather than by a route guard. Reproducing that check in a
   * resolver would be a second implementation of a permission rule —
   * so the flag is simply not offered here. A client that needs deleted tickets
   * uses the REST route, which already has the check.
   */
  static readonly clampedTo = MAX_PAGE_SIZE;
}
