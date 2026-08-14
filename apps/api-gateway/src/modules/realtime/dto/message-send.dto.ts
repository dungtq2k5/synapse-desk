import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_CONTENT_LENGTH,
} from '@synapsedesk/common';
import { NewAttachmentDto } from '../../tickets/dto/rest/message.dto';

/**
 * The `message:send` payload — 22-doc §2.
 *
 * **Validated explicitly, because a socket frame has no ValidationPipe.** There
 * is no global pipe on a WebSocket message unless one is wired per handler, so
 * every field here is checked in the handler rather than trusted into an RPC.
 */
export class MessageSendDto {
  @IsUUID()
  readonly ticketId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_CONTENT_LENGTH)
  readonly content!: string;

  /**
   * **Required, unlike its HTTP twin** — 22-doc §2.3.
   *
   * A socket that reconnects holding an unacked message re-emits it. That is
   * correct client behaviour, and without an id to dedup on it double-posts.
   * Required rather than optional so a client cannot opt out of the guarantee by
   * omitting it — the transport creates the requirement, so the transport's DTO
   * enforces it.
   */
  @IsUUID()
  readonly clientMessageId!: string;

  /**
   * **Refused rather than coerced when the caller is not an agent** — §2.2.
   *
   * The chat surface forces this false at its DTO. A socket must not silently do
   * the same: silent coercion hides a client bug, where a refusal reports it.
   * ticket-service makes the final call, and this field only carries the ask.
   */
  @IsOptional()
  @IsBoolean()
  readonly isInternalNote?: boolean;

  @IsOptional()
  @IsBoolean()
  readonly invokeAi?: boolean;

  /**
   * Objects already uploaded, bound as this message is created — 36-doc §1.3.
   *
   * **The socket needs this as much as HTTP does**, and more: this is the
   * surface where a customer attaches a screenshot and asks about it in the
   * same breath, and where `invokeAi` streams an answer moments later. Without
   * it the answer is generated before the file it is about is bound.
   *
   * Nested validation is explicit here for the reason the class docblock gives
   * — a socket frame reaches no ValidationPipe unless the handler wires one, so
   * an unvalidated array would reach an RPC as whatever the client sent.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @ValidateNested({ each: true })
  @Type(() => NewAttachmentDto)
  readonly attachments?: NewAttachmentDto[];
}
