import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_BULK_NOTIFICATION_IDS,
  MAX_FEED_CURSOR_LENGTH,
  NOTIFICATION_FEED_LIMIT,
} from '../../../../common/config/dto.config';
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
  type NotificationType,
} from '@synapsedesk/common';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';

/**
 * The feed query — CURSOR-paginated, so no `page`.
 *
 * Deliberately not extending `SearchPaginationDto`: that carries `page` and
 * `sortBy`, and offering either here would be an API that cannot keep its word.
 * The feed is always newest-first, and a page number over a list that grows at
 * the head shifts rows under the reader.
 */
export class ListNotificationsQueryDto {
  @IsOptional()
  @IsIn(NOTIFICATION_TYPE_VALUES)
  readonly type?: NotificationType;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly unreadOnly: boolean = false;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeArchived: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_FEED_CURSOR_LENGTH)
  readonly cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_FEED_LIMIT.MAX)
  @ApiPropertyOptional()
  readonly limit: number = NOTIFICATION_FEED_LIMIT.DEFAULT;
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
  @ArrayMaxSize(MAX_BULK_NOTIFICATION_IDS)
  @IsUUID('4', { each: true })
  @ApiPropertyOptional()
  readonly ids: string[] = [];

  @IsOptional()
  @IsIn(Object.values(NotificationResourceType))
  readonly resourceType?: NotificationResourceType;

  @IsOptional()
  @IsUUID('4')
  readonly resourceId?: string;
}

export class UpdatePreferenceDto {
  /** A known type, or `'*'` for the catch-all that turns a channel off wholesale. */
  @IsIn([PREFERENCE_WILDCARD_TYPE, ...NOTIFICATION_TYPE_VALUES])
  readonly type!: NotificationType | typeof PREFERENCE_WILDCARD_TYPE;

  // `WEBHOOK` is absent on purpose: it is in the channel enum for completeness
  // and has no implementation, so a preference for it would control nothing.
  @IsIn(PREFERENCE_CHANNELS)
  readonly channel!: (typeof PREFERENCE_CHANNELS)[number];

  // No `@ToBoolean()`: this arrives in a JSON BODY, where `true` is already a
  // boolean, whereas the query DTOs above parse strings.
  //
  // The reason used to be that coercing would turn `"false"` into `true` — that
  // was a description of `@Type(() => Boolean)`, and `@ToBoolean` never did it.
  // The decision stands on the narrower ground: a body field that is already
  // the right type needs no transform, and adding one would quietly accept the
  // STRING `"true"` on a route whose contract says boolean.
  @IsOptional()
  @IsBoolean()
  readonly isEnabled?: boolean;

  @IsOptional()
  @IsIn(Object.values(DigestMode))
  readonly digest?: DigestMode;
}
