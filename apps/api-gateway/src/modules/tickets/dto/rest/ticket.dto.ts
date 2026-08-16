import { MAX_STATUS_CHANGE_REASON_LENGTH } from '../../../../common/config/dto.config';
import { OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  DEFAULT_SEARCH,
  MAX_BULK_TICKET_IDS,
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

export class ListTicketsQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(TICKET_SORTABLE_FIELDS)
  /**
   * Optional in the API and, without this, REQUIRED in the docs
   *
   * The plugin derives `required` from TYPESCRIPT optionality, not from
   * `@IsOptional()`. A field declared `page: number = 1` is non-optional to the
   * compiler even though the validator lets a caller omit it, so the generated
   * spec demanded it — and a generated client would refuse to send a request
   * without one.
   */
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
