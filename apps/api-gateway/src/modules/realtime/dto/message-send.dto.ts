import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_MESSAGE_CONTENT_LENGTH } from '@synapsedesk/common';

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
}
