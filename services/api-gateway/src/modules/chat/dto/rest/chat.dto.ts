import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TICKET_DESCRIPTION_LENGTH,
  MAX_TICKET_TITLE_LENGTH,
  TicketPriority,
} from '@synapsedesk/contracts';
import { trimIfString } from '@synapsedesk/core';
import { NewAttachmentDto } from '../../../tickets/dto/rest/message.dto';

/**
 * Starting a conversation.
 *
 * Deliberately NOT `CreateTicketDto`. Two fields that DTO accepts are absent
 * here and their absence is the point:
 *
 *   - `source`, because a chat is a chat; letting a client set it would allow a
 *     conversation that reports itself as having arrived by email
 *   - `authorId`, because raising a ticket on somebody else's behalf is an
 *     agent action, and this is the end-user surface
 *
 * With `forbidNonWhitelisted`, sending either is a 400 rather than a silently
 * dropped field — a client that thought it was doing something is told it was
 * not.
 */
export class StartConversationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_TICKET_TITLE_LENGTH)
  @Transform(trimIfString)
  readonly title!: string;

  /** The opening question. Becomes the ticket's description. */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TICKET_DESCRIPTION_LENGTH)
  @Transform(trimIfString)
  readonly message!: string;

  @IsOptional()
  @IsIn(Object.values(TicketPriority))
  readonly priority?: TicketPriority;

  /**
   * The question's files, already uploaded through
   * `POST /tickets/attachments/upload-url`. Bound before the first answer is
   * asked for, so the answer reads them. A path that fails its confirm comes
   * back in `skippedAttachments`; the conversation starts regardless.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @ValidateNested({ each: true })
  @Type(() => NewAttachmentDto)
  @ApiPropertyOptional()
  readonly attachments: NewAttachmentDto[] = [];
}
