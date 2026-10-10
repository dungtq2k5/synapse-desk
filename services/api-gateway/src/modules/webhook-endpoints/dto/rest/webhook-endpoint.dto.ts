import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_WEBHOOK_DESCRIPTION_LENGTH,
  MAX_WEBHOOK_URL_LENGTH,
  NOTIFICATION_TYPE_VALUES,
  WEBHOOK_DELIVERY_LIMIT,
  type NotificationType,
} from '@synapsedesk/common';

/**
 * The endpoint's writable fields.
 *
 * The URL checks here are a COURTESY, not the control: the URL is validated
 * when saved and RESOLVED when delivered to, and DNS can change in between —
 * the real refusal happens in the sender on every request (the guarded
 * `lookup` for hostnames, the literal check for IP hosts). Refusing the
 * obvious cases at the edge just gives the tenant their error at save time
 * instead of on the first event.
 */
export class CreateWebhookEndpointDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(MAX_WEBHOOK_URL_LENGTH)
  readonly url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_WEBHOOK_DESCRIPTION_LENGTH)
  readonly description?: string;

  /**
   * At least one — an endpoint subscribed to nothing is refused at creation,
   * never created silently useless, and an empty list never means "all".
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NOTIFICATION_TYPE_VALUES.length)
  @IsIn(NOTIFICATION_TYPE_VALUES, { each: true })
  readonly eventTypes!: NotificationType[];
}

export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(MAX_WEBHOOK_URL_LENGTH)
  readonly url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_WEBHOOK_DESCRIPTION_LENGTH)
  readonly description?: string;

  /** Absent means "leave them"; an empty array is refused, same as create. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NOTIFICATION_TYPE_VALUES.length)
  @IsIn(NOTIFICATION_TYPE_VALUES, { each: true })
  readonly eventTypes?: NotificationType[];

  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;
}

export class ListWebhookDeliveriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WEBHOOK_DELIVERY_LIMIT.MAX)
  @ApiPropertyOptional()
  readonly limit: number = WEBHOOK_DELIVERY_LIMIT.DEFAULT;
}
