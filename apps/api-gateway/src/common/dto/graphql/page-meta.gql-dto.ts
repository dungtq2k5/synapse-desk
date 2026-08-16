import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * The pagination block every list field returns.
 *
 * **Offset pagination, matching REST** defers Relay cursors. Mixing
 * the two is worse than either: a client would have to know which fields take a
 * cursor and which take a page, and the SPA's existing calls are offset-based.
 *
 * Lives here rather than in a feature module because every page type embeds it —
 * `TicketPage`, `UserPage`, `DocumentPage` and `DepartmentPage` all point at
 * this one class, and a per-module copy would be four types named `PageMeta`
 * fighting over one schema name.
 */
@ObjectType('PageMeta')
export class PageMetaGqlDto {
  /** Total matching records, across every page. */
  @Field(() => Int)
  totalItems!: number;

  /** Records on THIS page — smaller than `itemsPerPage` on the last one. */
  @Field(() => Int)
  itemCount!: number;

  /**
   * The page size actually used.
   *
   * Reads back the CLAMPED value, not what was asked for A client
   * that requested 500 and received 100 can see that here rather than inferring
   * it from a short array, which is indistinguishable from running out of rows.
   */
  @Field(() => Int)
  itemsPerPage!: number;

  @Field(() => Int)
  totalPages!: number;

  @Field(() => Int)
  currentPage!: number;
}
