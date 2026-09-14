/**
 * @file The `data` half of every SERVER→CLIENT frame this gateway builds itself.
 *
 * **Classes, like every other response shape in this service.** They carry no
 * decorators and are never instantiated — `satisfies` is erased at compile time
 * — so a class here costs one unused class object and buys the thing that
 * matters: one construct for an outbound shape whatever the transport. The REST
 * response DTOs (`NotificationResponseDto`, `PreferenceResponseDto`) are
 * decorator-free classes for the same reason, and a reader should not have to
 * remember which protocol gets an interface.
 *
 * Contrast the two DTOs beside this file. `MessageSendDto` and
 * `PresenceUpdateDto` are INBOUND and carry `class-validator` decorators,
 * because a socket frame reaches no `ValidationPipe` and is whatever the client
 * sent. Nothing here is validated: it is what the server chose to send.
 *
 * **Only the frames this gateway CONSTRUCTS are here.** The relayed events —
 * `ticket:*`, `message:*`, `notification:new`/`updated`/`read`,
 * `document:indexed`/`failed` — forward their domain event verbatim and are
 * typed by the contract that defines them (`TicketEventOf<…>` and friends).
 * Restating those shapes here would be a second copy of a contract that already
 * exists, and the two would drift.
 */

import { type FrameAnswerStatus } from '../realtime.config';
import { CitationResponseDto } from '../../tickets/dto/rest/message-response.dto';
import { PresenceState } from '../realtime.config';

/** `connection:ready` — the "you may start emitting" frame. */
export class ConnectionReadyPayloadDto {
  userId!: string;
  /** `null` for a platform account, which belongs to no tenant. */
  organizationId!: string | null;
}

/** `ticket:joined` — confirms an authorized `ticket:join`. */
export class TicketJoinedPayloadDto {
  ticketId!: string;
}

/**
 * `presence` — a peer's availability changed. Room: `org:{id}`.
 *
 * `state` is `PresenceState`, not `string`: the union is what stops a fifth
 * state reaching clients that only know four, and it is the field a widening
 * would silently pass through.
 */
export class PresencePayloadDto {
  userId!: string;
  state!: PresenceState;
}

/**
 * `typing` — someone is replying. Room: `ticket:{id}`, minus the sender.
 *
 * `ttlMs` is on the frame because the CLIENT expires the indicator: `typing:stop`
 * is a hint that a closed tab, a dead battery and a lost network all skip.
 *
 */
export class TypingPayloadDto {
  ticketId!: string;
  userId!: string;
  isTyping!: boolean;
  ttlMs!: number;
}

/** `ai:stream:chunk` — one token, to the requesting socket alone. */
export class AiStreamChunkPayloadDto {
  streamId!: string;
  ticketId!: string;
  token!: string;
}

/**
 * `ai:stream:done` — the stream finished.
 *
 * Carries `messageId` because a client receiving both this and `message:new`
 * reconciles them on the id. `null` when the answer was never
 * persisted — the cap path, where the conversation escalated instead.
 */
export class AiStreamDonePayloadDto {
  streamId!: string;
  ticketId!: string;
  messageId!: string | null;
  content!: string;
  /** The same shape `GET …/messages` serves on the persisted message. */
  citations!: CitationResponseDto[];
  /** True on the cap path — a human is now handling it, not an error. */
  escalated!: boolean;
  status!: FrameAnswerStatus;
}

/**
 * `ai:stream:attachments-skipped` — files the model was not given.
 *
 * **Names only, never contents.** These were skipped precisely because their
 * bytes could not be used, and echoing bytes into a socket frame is the one
 * thing this event must not do — the same rule `error_log` and
 * `DocumentFlag.detail` follow.
 *
 * Sent before the stream opens rather than folded into `ai:stream:done`, so a
 * client can show "logs.zip was not read" while the answer is still arriving,
 * and so the notice survives a stream that later fails.
 */
export class AiStreamAttachmentsSkippedPayloadDto {
  ticketId!: string;
  fileNames!: string[];
}

/**
 * The `data` rider on `ai:stream:error`.
 *
 * Sits alongside the `ErrorResponse` envelope rather than inside a `WsResponse`,
 * because the failure arm reuses the same error shape every REST route and the
 * exception filter emit. It exists so a client can clear the ONE pending stream
 * that died rather than all of them.
 */
export class AiStreamErrorPayloadDto {
  streamId!: string;
  ticketId!: string;
}

/**
 * `notification:unread-count` — the authoritative badge number.
 *
 * **Emitted bare, NOT inside a `WsResponse`**, unlike every other frame this
 * process constructs. Typed here as what it currently is rather than as what it
 * arguably should be: changing the envelope is a client-visible wire change, and
 * a typing pass is the wrong place to make one silently.
 */
export class UnreadCountPayloadDto {
  count!: number;
}
