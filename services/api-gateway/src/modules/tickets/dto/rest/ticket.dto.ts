import { MARKDOWN_FIELD_CONTRACT } from '../../../../common/config/markdown-contract.config';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  DEFAULT_SEARCH,
  MAX_BULK_TICKET_IDS,
  MAX_STATUS_CHANGE_REASON_LENGTH,
  MAX_TICKET_DESCRIPTION_LENGTH,
  MIN_TICKET_TITLE_LENGTH,
  MAX_TICKET_TITLE_LENGTH,
  TICKET_SORTABLE_FIELDS,
  TicketPriority,
  TicketSource,
  TicketStatus,
  trimIfString,
  type TicketSortableField,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';

export class CreateTicketDto {
  @IsString()
  @MinLength(MIN_TICKET_TITLE_LENGTH)
  @MaxLength(MAX_TICKET_TITLE_LENGTH)
  @Transform(trimIfString)
  readonly title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TICKET_DESCRIPTION_LENGTH)
  @Transform(trimIfString)
  @ApiProperty({ description: MARKDOWN_FIELD_CONTRACT })
  readonly description!: string;

  @IsOptional()
  @IsIn(Object.values(TicketPriority))
  readonly priority?: TicketPriority;

  @IsOptional()
  @IsIn(Object.values(TicketSource))
  readonly source?: TicketSource;

  /**
   * Raising a ticket on behalf of an end user.
   *
   * Absent means "the caller", which is the ordinary case and needs no
   * validation because the id comes from a verified token. When present it is
   * checked against auth-service before the insert — there is no foreign key
   * that could do it, since `users` lives in another database.
   */
  @IsOptional()
  @IsUUID('4')
  readonly authorId?: string;
}

/**
 * `status` is deliberately ABSENT.
 *
 * Status moves through the state machine and nowhere else. Accepting it here
 * would be a second, unvalidated path around the transition table — and
 * `forbidNonWhitelisted` turns an attempt into a 400 rather than a silent
 * ignore, which is what tells a client to use the right endpoint.
 */
export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @MinLength(MIN_TICKET_TITLE_LENGTH)
  @MaxLength(MAX_TICKET_TITLE_LENGTH)
  @Transform(trimIfString)
  readonly title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TICKET_DESCRIPTION_LENGTH)
  @Transform(trimIfString)
  @ApiPropertyOptional({ description: MARKDOWN_FIELD_CONTRACT })
  readonly description?: string;

  @IsOptional()
  @IsIn(Object.values(TicketPriority))
  readonly priority?: TicketPriority;
}

export class ChangeTicketStatusDto {
  @IsIn(Object.values(TicketStatus))
  readonly status!: TicketStatus;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_STATUS_CHANGE_REASON_LENGTH)
  @Transform(trimIfString)
  readonly reason?: string;
}

/**
 * The optional body on `/escalate`, `/resolve`, `/reopen` and `/close`.
 *
 * The same two validators `ChangeTicketStatusDto` puts on its own `reason`,
 * and it exists because those four are now the ONLY way to reach their
 * transitions — `POST /:id/status` refuses `RESOLVED` and `CLOSED`, so without
 * this the two transitions a history is most read to explain would be the two
 * that could never carry an explanation.
 *
 * The whole body is optional: none of the four required one before.
 */
export class TicketStatusActionDto {
  /**
   * Why the ticket moved, recorded on its status history.
   *
   * **Agent-facing**: a caller without queue access sees every transition and
   * only the reasons they wrote themselves, the same rule internal notes
   * follow. Not a message to the customer — `POST /tickets/:id/messages` is
   * that.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STATUS_CHANGE_REASON_LENGTH)
  @Transform(trimIfString)
  @ApiPropertyOptional({
    description:
      'Why the ticket moved. Recorded on the status history and visible to agents; the ticket author sees only reasons they wrote themselves.',
  })
  readonly reason?: string;
}

/**
 * The body of `POST /tickets/:ticketId/read`.
 *
 * `readAt` is the `createdAt` of the newest message the client actually
 * rendered — not "now". Letting the server stamp its own clock marks read every
 * message inserted between the render and this request landing, which on a live
 * ticket with an agent typing is a message the user never saw.
 *
 * Optional: a client with nothing rendered has nothing to name, and the server
 * falls back to its own clock. Clamped there too, so a fast client clock cannot
 * mark the future read.
 */
export class MarkTicketReadDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @ApiPropertyOptional()
  readonly readAt?: Date;
}

export class BulkTicketStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  // Capped at the DTO edge as well as in the service: the service is reachable
  // from other services over gRPC where no ValidationPipe ever ran, so neither
  // check makes the other redundant.
  @ArrayMaxSize(MAX_BULK_TICKET_IDS)
  @IsUUID('4', { each: true })
  readonly ticketIds!: string[];

  @IsIn(Object.values(TicketStatus))
  readonly status!: TicketStatus;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_STATUS_CHANGE_REASON_LENGTH)
  @Transform(trimIfString)
  readonly reason?: string;
}

/**
 * No `reason`, unlike {@link BulkTicketStatusDto}.
 *
 * Priority has no state machine and no terminal states — any value to any
 * value — so there is nothing a change here needs to be justified against.
 */
export class BulkTicketPriorityDto {
  @IsArray()
  @ArrayMinSize(1)
  // Capped at the DTO edge as well as in the service, for the reason given on
  // `BulkTicketStatusDto`: the service is reachable over gRPC where no
  // ValidationPipe ever ran.
  @ArrayMaxSize(MAX_BULK_TICKET_IDS)
  @IsUUID('4', { each: true })
  readonly ticketIds!: string[];

  @IsIn(Object.values(TicketPriority))
  readonly priority!: TicketPriority;
}

export class ListTicketsQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  /** Which column the list is ordered by. Defaults to the search default. */
  @IsOptional()
  @IsString()
  @IsIn(TICKET_SORTABLE_FIELDS)
  // `@ApiPropertyOptional()` is required here: the Swagger plugin derives
  // `required` from TYPESCRIPT optionality, not from `@IsOptional()`. A field
  // declared `sortBy: T = default` is non-optional to the compiler even though
  // the validator lets a caller omit it, so the spec would demand it and a
  // generated client would refuse to send a request without one.
  @ApiPropertyOptional()
  readonly sortBy: TicketSortableField = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsIn(Object.values(TicketStatus))
  readonly status?: TicketStatus;

  @IsOptional()
  @IsIn(Object.values(TicketPriority))
  readonly priority?: TicketPriority;

  @IsOptional()
  @IsIn(Object.values(TicketSource))
  readonly source?: TicketSource;

  @IsOptional()
  @IsUUID('4')
  readonly assigneeId?: string;

  @IsOptional()
  @IsUUID('4')
  readonly departmentId?: string;

  @IsOptional()
  @IsUUID('4')
  readonly authorId?: string;

  /**
   * Requires `ticket.delete` — the module's manage permission — which the
   * controller enforces. Without that gate any member could enumerate deleted
   * tickets, which is exactly the history someone would delete a ticket to
   * remove.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeDeleted: boolean = false;
}

/**
 * `POST /tickets/export`.
 *
 * The range is required and bounded (`MAX_EXPORT_SPAN_DAYS`), because the byte
 * bound counts rows while a span counts days and neither alone holds the line —
 * `MAX_EXPORT_ROWS` is the one that does, checked pre-flight by the renderer so
 * the refusal can name the count.
 */
export class CreateTicketExportDto {
  @IsISO8601({ strict: true })
  readonly from!: string;

  @IsISO8601({ strict: true })
  readonly to!: string;

  @IsOptional()
  @IsUUID('4')
  readonly departmentId?: string;

  /** `status`, `priority`, `assigneeId` — refused per kind at the service. */
  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  readonly filters?: Record<string, string>;
}
