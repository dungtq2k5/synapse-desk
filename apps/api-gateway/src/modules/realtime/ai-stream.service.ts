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
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg, RequestContext } from '@synapsedesk/common';
import type { ErrorResponse } from '../../common/interfaces/http-response.interface';
import { WsResponse } from '../../common/interfaces/ws-response.interface';
import { MessagesGrpcClient } from '../tickets/messages-grpc.client';
import { TicketsGrpcClient } from '../tickets/tickets-grpc.client';
import { ListMessagesQueryDto } from '../tickets/dto/rest/message.dto';
import { REALTIME_EVENTS } from './realtime.config';
import {
  AiStreamChunkPayloadDto,
  AiStreamDonePayloadDto,
  AiStreamErrorPayloadDto,
} from './dto/realtime-payload.dto';
import { socketStore } from './socket-store';

/** How much of the thread the answer is allowed to see. */
const TRANSCRIPT_TURNS = 40;

/**
 * The most frames Socket.IO may have queued for a socket before the stream is
 * abandoned — 22-doc §5.2.
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
 * 22-doc §5.
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
    private readonly messages: MessagesGrpcClient,
    private readonly tickets: TicketsGrpcClient,
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
  ): Promise<string> {
    // The thread so far, so the answer replies to the conversation rather than
    // to its last line. Read through the same client the REST list route uses,
    // so ticket-service applies the same visibility filter — an internal note
    // the caller may not read is not in the transcript the caller's answer is
    // generated from.
    const history = await this.transcript(ticketId, context);

    const streamId = randomUUID();
    const tokens: string[] = [];
    let completed = false;

    const subscription = this.ragService
      .chat(
        { message: question, history, ticketId },
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
            void this.settle(client, streamId, ticketId, context, {
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
            });
          }
        },
        error: (error: unknown) => {
          this.forget(client, streamId);
          // **Nothing is persisted here** — 22-doc §5 test 7. A partial answer
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
   * `ai:stream:cancel` — 22-doc §5.2.
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
   * §5 test 8, and the failure it prevents is one socket cancelling another
   * user's generation by guessing a uuid.
   */
  cancel(client: Socket, streamId: string): boolean {
    const stream = this.streamsOf(client).get(streamId);
    if (!stream) return false;

    this.forget(client, streamId);
    // **Unsubscribing IS the gRPC cancellation.** Nest's stream client calls
    // `call.cancel()` in its teardown, so this propagates to rag-service as a
    // real CANCELLED status — which is what triggers the shielded ledger write
    // there (13-doc §4.1). A socket-side `return` that merely stopped emitting
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
  ): Promise<void> {
    this.forget(client, streamId);

    try {
      // **At the cap this is `done`, never `error`** — 22-doc §5.2. The tenant
      // has run out of AI budget, the conversation auto-escalates, and a human
      // now has it. A 402-shaped error frame would tell the user the product is
      // broken at the moment it did the most useful thing it can do.
      // **`REFUSED` deliberately does NOT branch here** — 33-doc §5.1. A
      // question refused by injection detection takes the same path as a
      // greeting: the reply is appended, the thread keeps its record, and
      // nothing escalates, because the workspace's budget is untouched and
      // there is nothing for a human to pick up. `statusName` carries the
      // distinction to the client, which is the entire reason the proto gained
      // a value rather than reusing `GREETING`.
      if (completion.status === AnswerStatus.ANSWER_STATUS_AT_CAP) {
        const ticket = await this.tickets.escalate(ticketId, context);

        this.done(client, streamId, ticketId, {
          messageId: null,
          content: '',
          citations: [],
          escalated: true,
          status: 'AT_CAP',
        });
        this.logger.log(
          `Stream ${streamId} hit the AI cap; ticket ${ticket.id} escalated`,
        );
        return;
      }

      const message = await this.messages.appendAi(
        ticketId,
        completion.content,
        completion.generationId,
        context,
      );

      // Carries the message id, which is the whole reason `done` and
      // `message:new` are both emitted: the requesting client already has the
      // text and reconciles the two frames on this id.
      this.done(client, streamId, ticketId, {
        messageId: message.id,
        content: completion.content,
        citations: completion.citations,
        escalated: false,
        status: statusName(completion.status),
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
      status: string;
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

    return page.items.map((item) => ({
      role: item.isAiGenerated || !item.senderId ? 'assistant' : 'user',
      content: item.content,
    }));
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

  /** Whether Socket.IO has more queued for this socket than §5.2 allows. */
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

/** The proto enum as a name a client can switch on. */
function statusName(status: AnswerStatus): string {
  return AnswerStatus[status]?.replace('ANSWER_STATUS_', '') ?? 'UNSPECIFIED';
}

/**
 * How many frames engine.io still has queued for this socket, or `null` when
 * the internal is no longer readable.
 *
 * The single place that reaches past Socket.IO's public types. Isolated here so
 * the next person upgrading engine.io has one function to check rather than a
 * cast buried in a guard, and so the read is validated rather than asserted:
 * `Array.isArray` is what distinguishes "nothing queued" from "this property is
 * gone", which `?.length ?? 0` reported identically.
 */
function bufferedFrames(client: Socket): number | null {
  const { writeBuffer } = client.conn as unknown as {
    writeBuffer?: unknown;
  };

  return Array.isArray(writeBuffer) ? writeBuffer.length : null;
}
