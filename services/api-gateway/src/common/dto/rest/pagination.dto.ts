import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_SEARCH,
  SORT_ORDER_OPTIONS,
  type SortOrder,
} from '@synapsedesk/common';

/**
 * Pagination and sorting, with NO search term.
 *
 * **The base a list DTO gets unless it can actually search.** `SearchPaginationDto`
 * adds `searchTerm` and extends this one, so the wider shape is the opt-in
 * rather than the default — a route that advertises a filter it ignores has to
 * choose to do so now.
 *
 * ---
 *
 * **ADR 0032 — the pre-client clearing. This is the record for THREE breaking
 * changes, made once.**
 *
 * When these were made `enableVersioning` was off, so a response-shape change
 * was unversioned by construction.
 * [ADR 0032](../../../../../../docs/decisions/0032-unversioned-breaking-changes-are-counted.md)
 * permits that while no client has shipped and requires each one to be
 * recorded, because *"the count is the signal"* — a second is worth noticing, a
 * third means the assumption has expired.
 *
 * The standing record is on `messages.controller.ts` `create`
 * (`{ message, skippedAttachments }`), and it ends with a commitment: *"the
 * next breaking change does not get to make this call by default."* Three more
 * records each deferring again would be exactly the drift the count exists to
 * catch, so these three land as **one deliberate clearing**:
 *
 *  - **known-gaps #6** — `searchTerm` was accepted and silently ignored on
 *    three list routes. It is now REFUSED there: the field left those DTOs, and
 *    `forbidNonWhitelisted` turns a stale caller's `?searchTerm=` into a 400
 *    naming the property. A documented filter is applied or refused, never
 *    swallowed. `Query.ingestionJobs(searchTerm:)` leaves the GraphQL schema
 *    for the same reason.
 *  - **known-gaps #12** — `AssignmentResponseDto.assignedById` narrowed from
 *    `string | null` to `string`. The null had no writer.
 *  - **known-gaps #9** — the export family was named for one of its four
 *    kinds; `AnalyticsExportResponseDto` is now `ExportResponseDto`, renamed
 *    before any client generated a type from it.
 *
 * **The rule that now binds: the next breaking change is the third, and it
 * turns `enableVersioning` on** rather than adding a fourth record. That is
 * what keeps this a clearing rather than a habit — a reader can tell the two
 * apart only if the boundary is written down, and this is where it is written.
 *
 * **Versioning is now on, at `v1`.** A breaking change to a route is
 * `@Version('2')` on its controller, serving both shapes side by side — not an
 * edit in place, and not another record here.
 */
export class PaginationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  // Guaranteed that this query will always be provided even if the client does not provide it
  //
  // Optional in the API and, without this, REQUIRED in the docs.
  // The plugin derives `required` from TYPESCRIPT optionality, not from
  // `@IsOptional()`. A field declared `page: number = 1` is non-optional to the
  // compiler even though the validator lets a caller omit it, so the generated
  // spec demanded it — and a generated client would refuse to send a request
  // without one.
  @ApiPropertyOptional()
  readonly page: number = DEFAULT_SEARCH.PAGE;

  @IsOptional()
  @IsInt()
  @Min(DEFAULT_SEARCH.MIN_LIMIT)
  @Max(DEFAULT_SEARCH.MAX_LIMIT)
  @Type(() => Number)
  @ApiPropertyOptional()
  readonly limit: number = DEFAULT_SEARCH.LIMIT;

  /**
   * Default sort column. `createdAt` suits most resources, but NOT all —
   * `user_departments` has `assignedAt` and no `createdAt` at all — so a list
   * DTO whose resource differs MUST override this default.
   *
   * Getting it wrong is not a cosmetic problem: the service allowlists sortable
   * columns and rejects anything else with 400, so an unoverridden default
   * makes the endpoint fail on a request with NO query parameters at all —
   * i.e. every default call from the UI.
   */
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  readonly sortBy: string = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsString()
  @IsIn(SORT_ORDER_OPTIONS)
  @ApiPropertyOptional()
  readonly sortOrder: SortOrder = DEFAULT_SEARCH.SORT_ORDER;
}
