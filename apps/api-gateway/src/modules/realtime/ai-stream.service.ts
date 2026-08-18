import {
  UNSPECIFIED_FRAME_STATUS,
  type FrameAnswerStatus,
} from './realtime.config';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import {
  AnswerStatus,
  ChatChunk,
  Citation,
  RAG_GRPC_CLIENT,
  RAG_SERVICE_NAME,
  RagServiceClient,
  packRequestContext,
  fromProtoRagAnswerStatus,
} from '@synapsedesk/grpc-proto';
import {
  AnswerStatus as DomainAnswerStatus,
  formatErrorMsg,
  RequestContext,
} from '@synapsedesk/common';
import type { ErrorResponse } from '../../common/interfaces/http-response.interface';
import { WsResponse } from '../../common/interfaces/ws-response.interface';
import { MessagesService } from '../tickets/messages.service';
import { TicketsService } from '../tickets/tickets.service';
import { ListMessagesQueryDto } from '../tickets/dto/rest/message.dto';
import { REALTIME_EVENTS } from './realtime.config';
import {
  AiStreamAttachmentsSkippedPayloadDto,
  AiStreamChunkPayloadDto,
  AiStreamDonePayloadDto,
  AiStreamErrorPayloadDto,
} from './dto/realtime-payload.dto';
import { socketStore } from './socket-store';

/** How much of the thread the answer is allowed to see. */
const TRANSCRIPT_TURNS = 40;

/**
 * The most frames Socket.IO may have queued for a socket before the stream is
 * abandoned.
 *
 * **Socket.IO applies no backpressure.** `emit` returns immediately whether the
 * peer is reading or not; unsent frames accumulate in the engine's write buffer.
 * A browser that has stopped consuming — a backgrounded tab on a bad connection,
 * a paused debugger — therefore grows this process's heap for as long as the
 * generation runs, while the generation itself is billed to the tenant.
 *
 * So a wedged consumer ends the stream instead. The tokens produced so far are
 * still persisted and still reach the room as `message:new`, which is the point:
 * the user loses the animation, not the answer.
 */
const MAX_BUFFERED_FRAMES = 512;

/**
 * A stream this socket owns, held on `client.data` — see {@link streamsOf}.
 */
type LiveStream = {
  ticketId: string;
  subscription: Subscription;
};

/**
 * The relay between rag-service's `Chat` server-stream and one socket —
 *
 *
 * Closes the gap the spec names: `Chat` has always been a stream and has always
 * been tested as one, and nothing carried it to a browser. A Tier 1 answer
 * arrived whole, after the full generation latency, through the unary `Draft`
 * path — so the product's entire pitch, the instant answer, was the one thing
 * the transport could not express.
 *
 * **The room gets the message; the socket gets the stream.** Tokens go to the
 * requesting socket alone. An agent watching the same thread has no use for
 * another user's answer assembling itself character by character, and the
 * finished message reaches the room by the path that already exists — the
 * `ticket.message_created` event that {@link TicketEventsConsumer} already
 * relays. Fanning tokens to the room would multiply the frame count by the
 * number of watchers for no added information.
 */
@Injectable()
export class AiStreamService implements OnModuleInit {
  private readonly logger = new Logger(AiStreamService.name);

  private ragService!: RagServiceClient;

  constructor(
    @Inject(RAG_GRPC_CLIENT) private readonly client: ClientGrpc,
    private readonly messages: MessagesService,
    private readonly tickets: TicketsService,
  ) {}

  onModuleInit(): void {
    this.ragService =
      this.client.getService<RagServiceClient>(RAG_SERVICE_NAME);
  }

  /**
   * Opens a stream for `question` and relays it to `client`.
   *
   * **Returns as soon as the call is open, not when it finishes.** The caller is
   * `message:send`, whose ack promises "your message was stored" — a promise the
   * user's own write already satisfied. Awaiting the generation here would make
   * the ack take as long as the answer, which is the exact latency streaming
   * exists to hide.
   */
  async start(
    client: Socket,
    ticketId: string,
    question: string,
    context: RequestContext,
    /**
     * The message this question was stored as.
     *
     * Optional so the one existing caller that has no message (a retry, a test)
     * still compiles, and because a question with no attachments is the common
     * case: an absent id and a message with no files produce the same empty
     * list and the same zero downloads.
     */
    messageId?: string,
  ): Promise<string> {
    // The thread so far, so the answer replies to the conversation rather than
    // to its last line. Read through the same client the REST list route uses,
    // so ticket-service applies the same visibility filter — an internal note
    // the caller may not read is not in the transcript the caller's answer is
    // generated from.
    const history = await this.transcript(ticketId, context);

    // **Asked for, not fetched.** This service has no storage client, and
    // ticket-service already does the identical filter-and-fetch for its two
    // `Draft` call sites. Eligibility is decided from the row
    // there, so an attached zip never costs a download.
    const attachments = messageId
      ? await this.messages.aiAttachments(messageId, context)
      : { parts: [], skipped: [] };

    if (attachments.skipped.length > 0) {
      // **Told, not silently dropped**, the same rule
      // applies to email attachments the worker could not carry. "It ignored my
      // file" is something a user discovers before you do.
      this.notifySkipped(client, ticketId, attachments.skipped);
    }

    const streamId = randomUUID();
    const tokens: string[] = [];
    let completed = false;

    const subscription = this.ragService
      .chat(
        // The bytes came from ticket-service above rather than from storage
        // here — this service still has no storage client, and its own
        // attachment route hands the client a signed URL rather than bytes.
        {
          message: question,
          history,
          ticketId,
          attachments: attachments.parts,
        },
        packRequestContext(context),
      )
      .subscribe({
        next: (chunk: ChatChunk) => {
          if (chunk.token) {
            tokens.push(chunk.token);
            this.relayToken(client, streamId, ticketId, chunk.token);
            return;
          }

          if (chunk.completion) {
            completed = true;
            // Not awaited inside `next`: an rxjs observer is synchronous, and a
            // rejected promise here would surface as an unhandled rejection
            // rather than as an `ai:stream:error`. `settle` owns its own
            // failure path.
            void this.settle(
              client,
              streamId,
              ticketId,
              context,
              {
                status: chunk.completion.status,
                // The whole answer as the service assembled it. Authoritative,
                // and NOT the tokens re-joined here — reassembling client-side
                // would make a dropped frame silently shorten the stored message.
                //
                // The join is the fallback for one real case: a completion frame
                // that carries a status but no content, where the tokens are all
                // that was ever produced. Persisting `''` there would fail the
                // content check and lose an answer the user already watched
                // arrive.
                content: chunk.completion.content || tokens.join(''),
                citations: chunk.completion.citations,
                generationId: chunk.completion.generationId || undefined,
              },
              messageId,
            );
          }
        },
        error: (error: unknown) => {
          this.forget(client, streamId);
          // **Nothing is persisted here**. A partial answer
          // written as though it were complete is worse than no answer: it
          // enters the permanent thread, is indistinguishable from a finished
          // one, and the user reads a policy that stops mid-sentence.
          this.fail(client, streamId, ticketId, formatErrorMsg(error));
        },
        complete: () => {
          this.forget(client, streamId);
          if (!completed) {
            // A stream that ended without a completion frame. Reachable if
            // rag-service dies mid-generation, and silent otherwise — the
            // client would sit on a pending stream forever.
            this.fail(
              client,
              streamId,
              ticketId,
              'The answer stream ended unexpectedly',
            );
          }
        },
      });

    this.streamsOf(client).set(streamId, { ticketId, subscription });

    return streamId;
  }

  /**
   * `ai:stream:cancel`.
   *
   * **Only works on the instance holding the call**, and that is a property of
   * the design rather than a limitation to route around. A socket lives on one
   * instance, so the in-flight gRPC call is reachable from the socket that
   * started it and from nowhere else. A client that reconnected to another
   * instance cannot cancel; {@link cancelAll} covers the case that actually
   * happens, which is the user closing the tab.
   *
   * **A stream this socket does not own is IGNORED**, not refused — the map is
   * per-socket, so an id belonging to somebody else simply is not in it. That is
   * and the failure it prevents is one socket cancelling another
   * user's generation by guessing a uuid.
   */
  cancel(client: Socket, streamId: string): boolean {
    const stream = this.streamsOf(client).get(streamId);
    if (!stream) return false;

    this.forget(client, streamId);
    // **Unsubscribing IS the gRPC cancellation.** Nest's stream client calls
    // `call.cancel()` in its teardown, so this propagates to rag-service as a
    // real CANCELLED status — which is what triggers the shielded ledger write
    // there. A socket-side `return` that merely stopped emitting
    // would leave the generation running and unbilled, spending money nothing
    // is watching.
    stream.subscription.unsubscribe();

    return true;
  }

  /** Every stream this socket owns — called on disconnect. */
  cancelAll(client: Socket): void {
    for (const streamId of this.streamsOf(client).keys()) {
      this.cancel(client, streamId);
    }
  }

  // -------------------------------------------------------------------------

  private relayToken(
    client: Socket,
    streamId: string,
    ticketId: string,
    token: string,
  ): void {
    if (this.isWedged(client)) {
      // The buffered frames are already unread; adding to them helps nobody.
      // The stream is dropped, and the answer still lands as a message.
      this.cancel(client, streamId);
      this.fail(client, streamId, ticketId, 'The stream fell too far behind');
      return;
    }

    client.emit(REALTIME_EVENTS.aiStreamChunk, {
      success: true,
      message: 'Streaming',
      data: { streamId, ticketId, token },
    } satisfies WsResponse<AiStreamChunkPayloadDto>);
  }

  /**
   * The terminal frame: persist, or escalate, then tell the socket.
   */
  private async settle(
    client: Socket,
    streamId: string,
    ticketId: string,
    context: RequestContext,
    completion: {
      status: AnswerStatus;
      content: string;
      citations: Citation[];
      generationId?: string;
    },
    /** The message that was asked — needed only on the refusal path. */
    messageId?: string,
  ): Promise<void> {
    this.forget(client, streamId);

    try {
      // **At the cap this is `done`, never `error`**. The tenant
      // has run out of AI budget, the conversation auto-escalates, and a human
      // now has it. A 402-shaped error frame would tell the user the product is
      // broken at the moment it did the most useful thing it can do.
      // **`REFUSED` deliberately does NOT branch here**. A
      // question refused by injection detection takes the same path as a
      // greeting: the reply is appended, the thread keeps its record, and
      // nothing escalates, because the workspace's budget is untouched and
      // there is nothing for a human to pick up. `toFrameAnswerStatus` carries the
      // distinction to the client, which is the entire reason the proto gained
      // a value rather than reusing `GREETING`.
      if (completion.status === AnswerStatus.ANSWER_STATUS_AT_CAP) {
        const ticket = await this.tickets.escalate(ticketId, context);

        this.done(client, streamId, ticketId, {
          messageId: null,
          content: '',
          citations: [],
          escalated: true,
          status: DomainAnswerStatus.AT_CAP,
        });
        this.logger.log(
          `Stream ${streamId} hit the AI cap; ticket ${ticket.id} escalated`,
        );
        return;
      }

      // **The write-back, on the refusal path only**. The gateway
      // is the one that holds this id, so the gateway is the one that sets the
      // flag: without it the refused question stays in the transcript and every
      // later turn in this conversation re-sends it to the model.
      //
      // Before the append, so a failure here surfaces through the same catch
      // rather than after a message the client has already been told about.
      if (
        completion.status === AnswerStatus.ANSWER_STATUS_REFUSED &&
        messageId
      ) {
        await this.messages.excludeFromAiContext(ticketId, messageId, context);
      }

      const message = await this.messages.appendAi(
        ticketId,
        completion.content,
        completion.generationId,
        context,
        // Persisted, so a thread read after the socket closed can still tell a
        // refusal from an answer. Null for a status this build cannot name,
        // which leaves the column NULL rather than writing `'UNSPECIFIED'` into
        // it as a value.
        fromProtoRagAnswerStatus(completion.status),
      );

      // Carries the message id, which is the whole reason `done` and
      // `message:new` are both emitted: the requesting client already has the
      // text and reconciles the two frames on this id.
      this.done(client, streamId, ticketId, {
        messageId: message.id,
        content: completion.content,
        citations: completion.citations,
        escalated: false,
        status: toFrameAnswerStatus(completion.status),
      });
    } catch (error) {
      // The generation succeeded and the write did not. Reported as an error
      // because from the client's point of view that is what happened — there
      // is no message id to reconcile against and no row for the room to
      // announce.
      this.fail(client, streamId, ticketId, formatErrorMsg(error));
    }
  }

  private done(
    client: Socket,
    streamId: string,
    ticketId: string,
    data: {
      messageId: string | null;
      content: string;
      citations: Citation[];
      escalated: boolean;
      status: FrameAnswerStatus;
    },
  ): void {
    client.emit(REALTIME_EVENTS.aiStreamDone, {
      success: true,
      message: data.escalated ? 'Handed off to an agent' : 'Answer complete',
      data: { streamId, ticketId, ...data },
    } satisfies WsResponse<AiStreamDonePayloadDto>);
  }

  private fail(
    client: Socket,
    streamId: string,
    ticketId: string,
    reason: string,
  ): void {
    this.logger.warn(`Stream ${streamId} failed: ${reason}`);

    client.emit(REALTIME_EVENTS.aiStreamError, {
      success: false,
      statusCode: 502,
      path: client.nsp?.name ?? '/',
      timestamp: new Date().toISOString(),
      error: reason,
      // Outside the `ErrorResponse` envelope's own fields, so a client can tell
      // WHICH pending stream just died rather than clearing all of them.
      data: { streamId, ticketId },
      // `ErrorResponse & { data }` rather than `WsResponse`: this is the failure
      // arm, so it carries the same shape the exception filter and every REST
      // error use, plus the one field that says which stream it was about.
    } satisfies ErrorResponse & { data: AiStreamErrorPayloadDto });
  }

  /**
   * Names what did not reach the model.
   *
   * A zip, a `.docx`, or a file past the byte ceiling is skipped rather than
   * failing the question: an answer about the screenshot beats no answer
   * because a spreadsheet came with it. What must not happen is silence —
   * "it ignored my file" is a thing a user discovers before anybody here does.
   */
  private notifySkipped(
    client: Socket,
    ticketId: string,
    fileNames: string[],
  ): void {
    client.emit(REALTIME_EVENTS.aiStreamAttachmentsSkipped, {
      success: true,
      message: 'Some attachments were not read',
      data: {
        ticketId,
        // Names only. The reason these were skipped is that their contents
        // could not be used, and echoing contents into a frame would be the one
        // thing this event must not do.
        fileNames,
      },
      // The envelope, not a bare object. Every other frame this service emits is
      // a `WsResponse`, and a client reading `frame.data` off a bare one gets
      // `undefined` — a notice that is delivered and unreadable, which looks
      // exactly like a notice that was never sent.
    } satisfies WsResponse<AiStreamAttachmentsSkippedPayloadDto>);
  }

  /**
   * The transcript, oldest first, in the roles rag-service expects.
   *
   * `senderId === null` means generated: the same rule ticket-service's unary
   * path uses, kept identical so a streamed answer and a drafted one see the
   * same conversation.
   */
  private async transcript(
    ticketId: string,
    context: RequestContext,
  ): Promise<Array<{ role: string; content: string }>> {
    const query: ListMessagesQueryDto = {
      page: 1,
      limit: TRANSCRIPT_TURNS,
      sortBy: 'createdAt',
      // OLDEST first. The list route defaults to newest-first, which is right
      // for a paged UI and backwards for a transcript — an answer generated
      // from a reversed conversation is answering the wrong turn.
      sortOrder: 'ASC',
    };

    const page = await this.messages.list(ticketId, query, context);

    return (
      page.items
        // **Filtered HERE, after the fetch — deliberately, and NOT the same
        // rule as `isInternalNote`**.
        //
        // An internal note is filtered in ticket-service's `where` clause
        // because those rows must never reach the caller at all; the internal-note leak
        // found the leak that fetch-then-filter produces there.
        //
        // **A refused message is the opposite.** The caller may absolutely see
        // it — it stays in the thread as the record of what somebody
        // attempted. What it must not reach is a PROMPT. So the risks differ
        // and the mechanisms differ with them.
        //
        // Moving this into a `where` clause would break the UI list, which is
        // served by this same route, or force a `forAiContext` flag onto
        // `ListMessagesRequest` — a proto field whose only job would be to make
        // one caller's post-processing look like a query.
        .filter((item) => !item.excludedFromAiContext)
        .map((item) => ({
          role: item.isAiGenerated || !item.senderId ? 'assistant' : 'user',
          content: item.content,
        }))
    );
  }

  /**
   * Live streams, keyed by id, held on the SOCKET.
   *
   * Same reasoning as the typing gate: `client.data` dies with the connection,
   * so a disconnect — clean, abrupt, or a crashed pod — leaves nothing to prune.
   * A provider-level `Map` keyed by socket id would need a `handleDisconnect` to
   * stay correct, and the entries belonging to a pod that died would never be
   * pruned at all. It also makes "does this socket own that stream?" a lookup
   * rather than a check somebody can forget to write.
   */
  private streamsOf(client: Socket): Map<string, LiveStream> {
    return socketStore(
      client,
      'aiStreams',
      () => new Map<string, LiveStream>(),
    );
  }

  private forget(client: Socket, streamId: string): void {
    this.streamsOf(client).delete(streamId);
  }

  /** Whether Socket.IO has more queued for this socket than the backpressure cap allows. */
  private isWedged(client: Socket): boolean {
    // `writeBuffer` is engine.io internals, absent from its public types.
    // Read structurally rather than tracked with a counter of our own, because
    // it is the ACTUAL backlog — a counter would measure what we emitted, not
    // what is still unsent, and those differ by exactly the amount this guard
    // cares about.
    //
    // **`Array.isArray`, not `?? 0`.** This is a library internal, so the field
    // can vanish in a minor upgrade — and defaulting a missing buffer to zero
    // would report every socket as healthy and disable the backpressure guard
    // silently, which is the one failure this method must not have. An absent
    // buffer is now `null`, and `null` is treated as wedged: refusing to stream
    // is recoverable, streaming into a socket that cannot drain is not.
    const buffered = bufferedFrames(client);

    if (buffered === null) {
      this.logger.warn(
        'engine.io no longer exposes `writeBuffer`; treating the socket as ' +
          'wedged. The backpressure guard needs updating for this version.',
      );

      return true;
    }

    return buffered > MAX_BUFFERED_FRAMES;
  }
}

/**
 * The WebSocket frame's status, as a name a client can switch on.
 *
 * Keeps `'UNSPECIFIED'` as its own case: a frame has to carry something, and a
 * client switching on the value needs a default arm it can name.
 *
 * For the FRAME only — anything persisted takes the domain `AnswerStatus`.
 */
function toFrameAnswerStatus(status: AnswerStatus): FrameAnswerStatus {
  return fromProtoRagAnswerStatus(status) ?? UNSPECIFIED_FRAME_STATUS;
}

/**
 * How many frames engine.io still has queued for this socket, or `null` when
 * that internal is no longer readable.
 *
 * The single place reaching past Socket.IO's public types — check this one
 * function when upgrading engine.io.
 */
function bufferedFrames(client: Socket): number | null {
  const { writeBuffer } = client.conn as unknown as {
    writeBuffer?: unknown;
  };

  return Array.isArray(writeBuffer) ? writeBuffer.length : null;
}
