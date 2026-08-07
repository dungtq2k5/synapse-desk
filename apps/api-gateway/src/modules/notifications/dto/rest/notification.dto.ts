import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DigestMode,
  NOTIFICATION_TYPE_VALUES,
  NotificationResourceType,
  PREFERENCE_CHANNELS,
  PREFERENCE_WILDCARD_TYPE,
} from '@synapsedesk/common';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';

/** How many ids one bulk-read may carry. Bounded because it arrives from a client. */
const MAX_BULK_IDS = 200;

/**
 * The feed query — CURSOR-paginated, so no `page`.
 *
 * Deliberately not extending `SearchPaginationBase`: that carries `page` and
 * `sortBy`, and offering either here would be an API that cannot keep its word.
 * The feed is always newest-first, and a page number over a list that grows at
 * the head shifts rows under the reader.
 */
export class ListNotificationsQueryDto {
  @IsOptional()
  @IsIn(NOTIFICATION_TYPE_VALUES)
  readonly type?: string;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly unreadOnly?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly includeArchived?: boolean = false;

  @IsOptional()
  @IsString()
  // Opaque, and length-bounded rather than pattern-matched: it is base64 of a
  // pair we issued, and validating its structure here would duplicate the
  // decoder that already returns null for anything it did not produce.
  @MaxLength(500)
  readonly cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit?: number = 20;
}

/**
 * Bulk read — `{ ids }` OR `{ resourceType, resourceId }`.
 *
 * Both optional at this layer and required as a pair by the service, because
 * "one of these two shapes" is not something class-validator expresses without
 * a custom validator that would be harder to read than the check it replaces.
 */
export class MarkManyReadDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BULK_IDS)
  @IsUUID('4', { each: true })
  readonly ids?: string[];

  @IsOptional()
  @IsIn(Object.values(NotificationResourceType))
  readonly resourceType?: string;

  @IsOptional()
  @IsUUID('4')
  readonly resourceId?: string;
}

export class UpdatePreferenceDto {
  /** A known type, or `'*'` for the catch-all that turns a channel off wholesale. */
  @IsIn([PREFERENCE_WILDCARD_TYPE, ...NOTIFICATION_TYPE_VALUES])
  readonly type!: string;

  // `WEBHOOK` is absent on purpose: it is in the channel enum for completeness
  // and has no implementation, so a preference for it would control nothing.
  @IsIn(PREFERENCE_CHANNELS)
  readonly channel!: string;

  // No `@ToBoolean()`: this arrives in a JSON BODY, where `true` is already a
  // boolean, whereas the query DTOs above parse strings. Coercing here would
  // turn the string `"false"` into `true` on the one route where a client can
  // legitimately send a real boolean.
  @IsOptional()
  @IsBoolean()
  readonly isEnabled?: boolean;

  @IsOptional()
  @IsIn(Object.values(DigestMode))
  readonly digest?: string;
}
