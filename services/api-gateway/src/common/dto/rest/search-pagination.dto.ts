import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from './pagination.dto';

/**
 * `PaginationDto` plus a free-text search term.
 *
 * **Extend this only where a service actually filters on it.** Seven list DTOs
 * extended it and two reached a service that called `toSearchFilter`; the other
 * five advertised `searchTerm` in Swagger, accepted it, and returned an
 * unfiltered page — which a caller reads as "no other matches exist"
 * (known-gaps #6). Two of the five gained a real filter; the remaining three
 * now extend {@link PaginationDto} and refuse the parameter outright.
 *
 * The split is the guard: a route gets the field by choosing a base class, so
 * the choice is visible in the class declaration rather than buried in whether
 * some service happens to call `toSearchFilter`.
 */
export class SearchPaginationDto extends PaginationDto {
  // `@ApiPropertyOptional` is explicit here, unlike the four inherited fields.
  // It reached Swagger before only because the CLI plugin infers optionality
  // from `searchTerm?: string`. The whole point of this row is that what
  // Swagger advertises is what the route does, so the one field that claim is
  // about should not depend on an inference.
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  readonly searchTerm?: string;
}
