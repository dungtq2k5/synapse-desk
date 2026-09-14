import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AppendAiMessageRequest,
  AttachmentResponse,
  CallerContext,
  ConfirmAttachmentRequest,
  CreateMessageRequest,
  CreateMessageResponse,
  ExcludeFromAiContextRequest,
  NewAttachment,
  DeleteAttachmentRequest,
  DeleteAttachmentResponse,
  DownloadAttachmentRequest,
  DownloadAttachmentResponse,
  emptyPage,
  ListAttachmentsRequest,
  ListAttachmentsResponse,
  ListMessagesRequest,
  ListMessagesResponse,
  MessageResponse,
  PresignAttachmentResponse,
  RedactMessageRequest,
  RedactMessageResponse,
  toPageMeta,
  toPrismaPage,
  toSearchFilter,
  toProtoTimestamp,
  UpdateMessageRequest,
  UploadAttachmentRequest,
  fromProtoMessageAnswerStatus,
} from '@synapsedesk/grpc-proto';
import {
  formatErrorMsg,
  MAX_MESSAGE_CONTENT_LENGTH,
  REDACTED_MESSAGE_PLACEHOLDER,
  isUniqueConstraintViolation,
  requireActor,
  TICKET_MESSAGE_SORTABLE_FIELDS,
  TICKET_PATTERNS,
  SupersededReason,
  ticketMessageGroupKey,
  PARSE_ELIGIBLE_MIME_TYPES,
  exceedsLimit,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiAttachmentService } from '../ai-attachments/ai-attachment.service';
import { isDraftRefusal } from '../ai-client/refusal';
import { recordInboundEmail, withInboundDedup } from '../tickets/inbound-dedup';
import { TicketEventPublisher } from '../events/ticket-event.publisher';
import { TicketAccessService } from '../ticket-access/ticket-access.service';
import { TicketsService } from '../tickets/tickets.service';
import { RagClientService } from '../ai-client/rag-client.service';
import { LedgerClientService } from '../ai-client/ledger-client.service';
import { AttachmentExtractorClient } from '../ai-client/attachment-extractor.client';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import {
  MessageAttachment,
  Prisma,
  TicketMessage,
} from '../../generated/prisma/client';
import {
  MessageWithAttachments,
  toAttachmentResponse,
  toMessageResponse,
  toStoredCitations,
} from './message.mapper';

/**
 * How long a download URL is advertised as valid.
 *
 * storage-service owns the real TTL; this is the value reported to the client,
 * deliberately a little SHORTER so a client that refreshes on expiry does so
 * before the URL actually dies rather than after.
 */
const READ_URL_GRACE_MS = 14 * 60 * 1000;

/**
 * How many messages the `invokeAi` reply path sends as context.
 *
 * The same bound the co-pilot uses and for the same reason: a long thread is
 * prompt tokens charged on every generation, and the tail is what the reply is
 * actually answering.
 */
const AI_REPLY_TRANSCRIPT_TURNS = 40;

/** A message plus the tenant of the ticket it hangs off. */
type LoadedMessage = TicketMessage & { organizationId: string };

/**
 * The ticket fields a `message_created` event needs.
 *
 * A structural type rather than the Prisma model, so the AI-reply path can pass
 * the same object it already loaded without a second read — and so adding a
 * column to `tickets` does not silently widen what this depends on.
 */
type NotifiableTicket = {
  id: string;
  organizationId: string;
  ticketNumber: bigint | number;
  authorId: string;
  currentAssigneeId: string | null;
};

/**
 * The ticket thread.
 *
 * Two rules carry most of the weight here, and both are about what a reader
 * must NOT be able to observe:
 *
 *   - internal notes are removed in the `WHERE` clause, never after the fetch
 *   - a redacted message keeps its row and loses its content
 *
 * The first is a security property, the second an audit one, and both are
 * easier to get subtly wrong than to get right — see the comments at each.
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  private readonly editWindowMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: TicketEventPublisher,
    private readonly tickets: TicketsService,
    private readonly access: TicketAccessService,
    private readonly rag: RagClientService,
    private readonly aiAttachments: AiAttachmentService,
    private readonly ledger: LedgerClientService,
    private readonly extractor: AttachmentExtractorClient,
    private readonly authReference: AuthReferenceService,
    private readonly storage: StorageReferenceService,
    private readonly configService: ConfigService,
  ) {
    this.editWindowMinutes = this.configService.getOrThrow<number>(
      'MESSAGE_EDIT_WINDOW_MINUTES',
    );
  }

  // ------------------------------------------------------------------------- Read

  async listMessages(
    request: ListMessagesRequest,
    context: CallerContext,
  ): Promise<ListMessagesResponse> {
    const ticket = await this.tickets.load(request.ticketId, context);
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      TICKET_MESSAGE_SORTABLE_FIELDS,
    );

    // `?searchTerm=` was on this DTO and honoured by nobody — an agent
    // narrowing a long thread got the whole thread back and read it as "no
    // other matches" (known-gaps #6). `content` is the column, and
    // `toSearchFilter` returns `undefined` for blank input so an unfiltered
    // list stays index-friendly.
    const search = toSearchFilter(page.searchTerm);

    const where: Prisma.TicketMessageWhereInput = {
      ticketId: ticket.id,
      ...this.access.internalNoteScope(context),
      ...(search ? { content: search } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.ticketMessage.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { attachments: true },
      }),
      // The SAME `where`. A count computed without the note filter would tell a
      // non-agent exactly how many notes they cannot see — the leak the filter
      // exists to prevent, reintroduced through the pagination meta.
      this.prisma.ticketMessage.count({ where }),
    ]);

    return {
      items: items.map(toMessageResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  // ------------------------------------------------------------------------- Write

  /**
   * Post a message, and optionally ask for an AI draft.
   *
   * With `invokeAi` these are TWO separate writes, never one transaction. The
   * draft can legitimately fail — `rag-service` does not exist yet, and will
   * still be able to be down once it does — and rolling back would throw away
   * what the human actually typed because a machine could not answer them.
   *
   * **Attachments are bound HERE, in the same call**. Presign and
   * confirm both took a `messageId`, so an attachment row could only be written
   * after its message existed, while `invokeAi` fires during this very call:
   * a first-turn screenshot was stored a moment after the answer that needed
   * it. Binding at create leaves no ordering for a client to get wrong.
   *
   * **A failed confirm skips that file and keeps the message**. The
   * presign record lives 600 seconds, and a user writing a careful ticket
   * around a screenshot takes longer than that often enough. `confirmUpload`
   * deliberately cannot tell an expired record from a forged path, so the only
   * outcome that serves both is a named skip — and failing the create would
   * contradict the rule the `invokeAi` split above already set.
   */
  async createMessage(
    request: CreateMessageRequest,
    context: CallerContext,
  ): Promise<CreateMessageResponse> {
    const ticket = await this.tickets.load(request.ticketId, context);
    const senderId = requireActor(context);
    const content = this.requireContent(request.content);

    if (request.isInternalNote && !this.canSeeInternalNotes(context)) {
      // Writing a note you could not then read would produce a message
      // invisible to its own author.
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Internal notes require agent access to this workspace',
      });
    }

    // **Idempotency, for the WebSocket path**.
    //
    // A socket that reconnects holding an unacked message re-emits it, which is
    // correct client behaviour and double-posts. Returning the ORIGINAL rather
    // than an error is deliberate: the client's intent was satisfied, and an
    // error would make it retry again.
    //
    // Checked before the insert AND enforced by `ticket_messages_client_key`,
    // because this read and the write below are two statements — two concurrent
    // re-emits both read "not seen" and both insert. The index is what makes one
    // of them lose; the catch below turns that loss into the same answer.
    if (request.clientMessageId) {
      const existing = await this.findByClientMessageId(
        ticket.id,
        request.clientMessageId,
      );
      // No skipped list on a duplicate: the original write already reported
      // its own, and re-confirming here would fail every path a second time —
      // `confirmUpload` collapses "already confirmed once" into the same
      // NOT_FOUND as an expiry, so a re-emit would report every attachment as
      // skipped for a message that has them.
      if (existing)
        return { message: toMessageResponse(existing), skippedAttachments: [] };
    }

    // `min(platform, tenant)`, resolved once for this message. The constant
    // alone was the cap until a tenant could narrow it; `MAX_ATTACHMENTS_PER_MESSAGE`
    // is still the ceiling this can never exceed.
    const limits = await this.authReference.getAttachmentLimits(context);

    if (exceedsLimit(request.attachments.length, limits.maxPerMessage)) {
      // The per-message cap, enforced where the count is now known. Presign
      // used to carry it, and cannot any more: without a message there is
      // nothing to count against.
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `A message can carry at most ${limits.maxPerMessage} attachments`,
      });
    }

    // **Outside the transaction, and before it opens.** Each confirm is a
    // network call to storage-service; holding a Prisma transaction open across
    // N of them is the shape that looks fine in a test and exhausts the
    // connection pool under load.
    const { confirmed, skippedAttachments } = await this.confirmNewAttachments(
      request.attachments,
      context,
    );

    // Outside the `try` because the `catch` below is narrow on purpose: it
    // exists to turn ONE error — the unique-constraint violation on
    // `client_message_id` — into the original message. Building this object
    // cannot throw, and widening the block to cover statements that cannot fail
    // makes the handler look like it is catching more than it is.
    const data = {
      ticketId: ticket.id,
      senderId,
      content,
      isInternalNote: request.isInternalNote,
      clientMessageId: request.clientMessageId ?? null,
      // Written WITH the message rather than after it, so there is no instant
      // at which the message exists without the files it was sent with — which
      // is the instant `invokeAi` used to run in.
      attachments: { create: confirmed },
    };

    let message: MessageWithAttachments;
    try {
      // **An inbound email's dedup row shares this insert's transaction** —
      // `client_message_id` above cannot serve: it is a UUID
      // column, and it is scoped to a ticket, while inbound dedup must also
      // work for the mail that CREATES one.
      //
      // The two idempotency keys coexist rather than compete — a WebSocket
      // re-emit and a provider redelivery are different events, and a message
      // that is both is deduped by whichever arrives second.
      message = request.inboundMessageId
        ? await withInboundDedup(() =>
            this.prisma.$transaction(async (tx) => {
              const created = await tx.ticketMessage.create({
                data,
                include: { attachments: true },
              });

              await recordInboundEmail(
                tx,
                ticket.organizationId,
                request.inboundMessageId!,
                ticket.id,
              );

              return created;
            }),
          )
        : await this.prisma.ticketMessage.create({
            data,
            include: { attachments: true },
          });
    } catch (error) {
      // The race the index exists for. The winner's row is the answer.
      if (isUniqueConstraintViolation(error) && request.clientMessageId) {
        const winner = await this.findByClientMessageId(
          ticket.id,
          request.clientMessageId,
        );
        if (winner)
          return { message: toMessageResponse(winner), skippedAttachments };
      }
      throw error;
    }

    this.publishCreated(ticket, message);

    if (request.generatedFromId) {
      // AFTER the message is committed, and non-blocking on failure. The reply
      // is already sent and the user has already seen it — losing it to
      // protect a metric would be exactly the wrong trade.
      //
      // Awaited rather than fire-and-forget because the comparison is what
      // decides ACCEPTED vs EDITED, and a sweep that later marked a SENT draft
      // DISCARDED would corrupt the one number justifying the co-pilot.
      await this.ledger.recordOutcome(
        request.generatedFromId,
        message.id,
        message.content,
        context,
      );
    }

    if (request.invokeAi) {
      // Awaited, but its failure is swallowed — the caller's own message is
      // already committed and is what this RPC promises to return. An AI draft
      // that could not be produced is a missing SECOND message, not a failed
      // request.
      await this.tryAppendAiReply(ticket, context);
    }

    return { message: toMessageResponse(message), skippedAttachments };
  }

  /**
   * Confirms every uploaded path, and reports the ones that did not.
   *
   * Sequential rather than `Promise.all`: these are writes against a peer, the
   * count is capped at the tenant's per-message limit, and a burst of
   * parallel confirms buys milliseconds while making the failure modes harder
   * to reason about.
   */
  private async confirmNewAttachments(
    attachments: NewAttachment[],
    context: CallerContext,
  ): Promise<{
    confirmed: Prisma.MessageAttachmentCreateWithoutMessageInput[];
    skippedAttachments: string[];
  }> {
    const confirmed: Prisma.MessageAttachmentCreateWithoutMessageInput[] = [];
    const skippedAttachments: string[] = [];

    for (const attachment of attachments) {
      const fileName = this.requireFileName(attachment.fileName);

      try {
        const object = await this.storage.confirmUpload(
          attachment.objectPath,
          context,
        );

        confirmed.push({
          fileName,
          // An object PATH, never a URL — the same rule `confirmAttachment`
          // follows, so a read resolves a fresh signed URL rather than trusting
          // one stored months ago.
          //
          // **`object.objectPath`, not `attachment.objectPath`**
          // The caller presigned into `pending/` and the object has
          // just moved out of it; storing what the client sent would record the
          // one path a lifecycle sweep is entitled to delete.
          fileUrl: object.objectPath,
          // Read back from the OBJECT, never from what the client declared.
          // Moving the confirm did not move that: a row built from the caller's
          // claims would record whatever they felt like claiming.
          fileSizeBytes: BigInt(object.sizeBytes),
          mimeType: object.contentType,
          // **The single extraction hook, and it has to be this one.** Both
          // attachment routes reach here — a client confirming its own upload,
          // and `createMessage` writing a message that arrived with files
          // already in storage. That second one is INBOUND EMAIL: the Worker
          // presigns, PUTs the bytes and sends paths, and this is where they
          // are confirmed.
          //
          // Hooking `confirmAttachment` alone would have left every emailed
          // office attachment unextracted, permanently and silently — on the
          // surface `injection.py` calls the highest-trust position an
          // untrusted file reaches in this system, because nobody sending it
          // ever authenticated.
          //
          // `object.contentType` for the same reason the column above uses it.
          extractedText: await this.extractIfParseable(
            object.objectPath,
            object.contentType,
            context,
          ),
        });
      } catch (error) {
        // **Named, not thrown.** An expired presign, a forged path and an
        // already-confirmed one are indistinguishable by design, so there is no
        // message this could produce that is both honest and useful — and the
        // typed message must survive either way.
        this.logger.warn(
          `Attachment could not be confirmed: ${formatErrorMsg(error)}`,
        );
        skippedAttachments.push(fileName);
      }
    }

    return { confirmed, skippedAttachments };
  }

  /**
   * The markdown for a parse-eligible attachment, or `null` for everything else.
   *
   * **Three outcomes, and the column holds all three.** `null` when nothing was
   * attempted — a `.png`, a `.doc`, a type with no parser — or when the attempt
   * failed. `''` when a parser ran and the file genuinely had no text. Text
   * when it worked. The feed path treats the first two identically and the
   * DIFFERENCE is for whoever debugs it later, which is why a `String[]` would
   * not do: Prisma scalar lists cannot be null.
   *
   * **Never throws**, because every caller is inside a confirm. `AttachmentExtractorClient`
   * already swallows its own failures; the eligibility check here is what stops
   * a `.png` costing a pointless round trip to ingestion-service.
   *
   * @param objectPath the CONFIRMED path, after the object left `pending/`.
   * @param mimeType read back from the object, never client-declared.
   */
  private async extractIfParseable(
    objectPath: string,
    mimeType: string,
    context: CallerContext,
  ): Promise<string | null> {
    if (!(PARSE_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      return null;
    }

    return this.extractor.extract(objectPath, mimeType, context);
  }

  /**
   * Persists a STREAMED AI answer, write #2.
   *
   * **The gateway holds the stream; this still holds the write.** Tokens have
   * to reach a socket and this service has none, so `Chat` is opened at the
   * gateway — but if the row were also written there, the streamed reply and
   * the unary `invoke_ai` reply would be two different rows written two
   * different ways, and the first divergence would be a generated message that
   * never published `ticket.message_created` and so never notified anybody.
   *
   * So this shares everything below the surface with {@link tryAppendAiReply}:
   * null sender, `isAiGenerated`, and the same `publishCreated`.
   *
   * **No `clientMessageId` and no idempotency.** The caller is a stream that
   * completed exactly once; a retry here would mean a second generation, which
   * is a second charge and a different answer — not the same write arriving
   * twice.
   */
  async appendAiMessage(
    request: AppendAiMessageRequest,
    context: CallerContext,
  ): Promise<MessageResponse> {
    // The SAME tenant and visibility check every other write runs. It is what
    // stops this RPC being a way to write into a ticket the caller cannot see,
    // and it is the only check available: the content is trusted because the
    // only caller is the gateway's relay, which took it from rag-service.
    const ticket = await this.tickets.load(request.ticketId, context);
    const content = this.requireContent(request.content);

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        // No sender. Attributing a generated message to a real person would
        // put words in their mouth in a permanent record.
        senderId: null,
        content,
        isAiGenerated: true,
        // **Persisted, where it used to be dropped**. The gateway
        // held this in the completion frame and threw it away on write, so once
        // the socket closed a thread could not tell a refusal from an answer.
        answerStatus: fromProtoMessageAnswerStatus(request.answerStatus),
        // Absent wrapper → column stays NULL. Never default it to `[]`: that
        // would record "cited nothing" for a caller that said nothing.
        ...(request.citations
          ? { citations: toStoredCitations(request.citations.items) }
          : {}),
      },
      include: { attachments: true },
    });

    // This is what puts `message:new` in the ticket room. The
    // socket that asked for the stream gets `ai:stream:done` as well, and the
    // two are not duplication: one settles a pending request, the other tells
    // a thread something appeared.
    this.publishCreated(ticket, message);

    if (request.generationId) {
      // Closes the acceptance loop for a streamed answer exactly as a
      // co-pilot draft does — the text was sent verbatim, so this records
      // ACCEPTED rather than leaving the row looking DISCARDED.
      await this.ledger.recordOutcome(
        request.generationId,
        message.id,
        message.content,
        context,
      );
    }

    return toMessageResponse(message);
  }

  /**
   * Marks a message as unusable for AI context.
   *
   * **The row survives and stays visible.** A refused message is the record of
   * what somebody attempted, and its position in the timeline is real — the
   * same reason `redactedAt` keeps its row. What changes is that no transcript
   * builder will hand it to a model again.
   *
   * **Not `isInternalNote`-shaped, and the difference is the whole design.** An
   * internal note must never reach the caller, so it is stripped in a `where`
   * clause. This one may reach the caller; it must not reach a prompt.
   *
   * Idempotent: setting the flag twice is the same as setting it once, which
   * matters because the caller is a failure path that may be retried.
   */
  async excludeFromAiContext(
    request: ExcludeFromAiContextRequest,
    context: CallerContext,
  ): Promise<MessageResponse> {
    const message = await this.loadMessage(
      request.ticketId,
      request.messageId,
      context,
    );

    const updated = await this.prisma.ticketMessage.update({
      where: { id: message.id },
      data: { excludedFromAiContext: true },
      include: { attachments: true },
    });

    return toMessageResponse(updated);
  }

  /**
   * Edit, inside the rules.
   *
   * Two distinct permissions, and they do NOT overlap:
   *   - the sender may edit their own message, briefly
   *   - a moderator may edit an INTERNAL NOTE at any time
   *
   * A moderator editing somebody else's public message is refused, and that is
   * the important half: an agent rewriting a customer's words in the permanent
   * thread is exactly the thing an audit timeline exists to make impossible.
   */
  async updateMessage(
    request: UpdateMessageRequest,
    context: CallerContext,
  ): Promise<MessageResponse> {
    const existing = await this.loadMessage(
      request.ticketId,
      request.messageId,
      context,
    );
    const content = this.requireContent(request.content);

    if (existing.redactedAt) {
      // Editing a redacted message would put content back where a moderator
      // deliberately removed it.
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'A redacted message cannot be edited',
      });
    }
    if (existing.isAiGenerated) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'A generated message cannot be edited',
      });
    }

    this.assertMayEdit(existing, context);

    const message = await this.prisma.ticketMessage.update({
      where: { id: existing.id },
      data: { content, editedAt: new Date() },
      include: { attachments: true },
    });

    // Published for the same reason the create is: without it a
    // socket showing the thread keeps the pre-edit text until it refreshes, and
    // an edit nobody sees is indistinguishable from an edit that did not save.
    this.events.publish({
      pattern: TICKET_PATTERNS.messageUpdated,
      organizationId: existing.organizationId,
      ticketId: message.ticketId,
      occurredAt: new Date().toISOString(),
      messageId: message.id,
      content: message.content,
      // Routes the relay's room split. Read from the stored row rather than the
      // request, because only the row knows.
      isInternalNote: message.isInternalNote,
      editedAt: (message.editedAt ?? new Date()).toISOString(),
    });

    return toMessageResponse(message);
  }

  /**
   * Redaction, not deletion.
   *
   * The row survives with a placeholder in place of its content, because its
   * POSITION in the timeline is the thing worth keeping: a thread that silently
   * loses a message reads as though the conversation never had that turn, and
   * the reply after it stops making sense. Same reasoning as Domain E's
   * `notifications` choosing `archived_at` over `deleted_at`.
   */
  async redactMessage(
    request: RedactMessageRequest,
    context: CallerContext,
  ): Promise<RedactMessageResponse> {
    const existing = await this.loadMessage(
      request.ticketId,
      request.messageId,
      context,
    );
    const actorId = requireActor(context);

    if (!this.canModerate(context)) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message:
          'Redacting a message requires the ticket.message.moderate permission',
      });
    }
    if (existing.redactedAt) {
      // A second redaction would move `redacted_at` forward and record a new
      // redactor for something already gone — rewriting the audit trail of the
      // very action the trail exists for.
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'That message is already redacted',
      });
    }

    const message = await this.prisma.ticketMessage.update({
      where: { id: existing.id },
      data: {
        content: REDACTED_MESSAGE_PLACEHOLDER,
        redactedAt: new Date(),
        redactedById: actorId,
      },
      include: { attachments: true },
    });

    // **No content on the wire**. The moderator removed those
    // words; shipping them in the removal notice would be the most direct way
    // to defeat the redaction.
    this.events.publish({
      pattern: TICKET_PATTERNS.messageRedacted,
      organizationId: existing.organizationId,
      ticketId: message.ticketId,
      occurredAt: new Date().toISOString(),
      messageId: message.id,
      isInternalNote: message.isInternalNote,
      redactedAt: (message.redactedAt ?? new Date()).toISOString(),
    });

    return { message: toMessageResponse(message) };
  }

  // ------------------------------------------------------------------------- Attachments

  /**
   * Presign an attachment upload.
   *
   * **`messageId` is optional**. With one, this attaches to a
   * message that already exists and nothing changes. Without one, the client is
   * uploading files it will hand to `CreateMessage`, which is the only ordering
   * in which a first-turn attachment can be read by that turn's answer.
   *
   * The per-message CAP is enforced HERE **when there is a message**, before
   * storage-service is called at all.2 test 1 asks for exactly that.
   * Checking it downstream instead would hand a caller who is already at the
   * cap a perfectly usable upload URL, and they would only discover the refusal
   * after uploading the bytes. With no message there is nothing to count, so
   * `CreateMessage` enforces the same cap over the list it is given — a
   * presigned URL that is never bound costs an orphaned object, which is a
   * class that already exists.
   */
  async uploadAttachment(
    request: UploadAttachmentRequest,
    context: CallerContext,
  ): Promise<PresignAttachmentResponse> {
    // The ticket is loaded either way. It is what authorizes the write, and
    // `loadMessage` was carrying that check as a side effect — dropping it for
    // the message-less path would let anyone presign into any ticket's prefix.
    const ticket = await this.tickets.load(request.ticketId, context);

    const message = request.messageId
      ? await this.loadMessage(request.ticketId, request.messageId, context)
      : null;

    const limits = await this.authReference.getAttachmentLimits(context);

    if (exceedsLimit(request.fileSizeBytes, limits.maxBytes)) {
      // The tenant's own ceiling, refused BEFORE a URL is signed. The DTO's
      // `@Max` already rejected anything over the platform constant; this is
      // the narrower number, and it has to be checked here because a decorator
      // argument is evaluated once at class-definition time and can never carry
      // a per-tenant value.
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `This workspace does not accept attachments over ${limits.maxBytes} bytes`,
      });
    }

    if (message) {
      const existing = await this.prisma.messageAttachment.count({
        where: { messageId: message.id },
      });
      if (existing >= limits.maxPerMessage) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: `A message can carry at most ${limits.maxPerMessage} attachments`,
        });
      }
    }

    try {
      const presigned = await this.storage.presignAttachment(
        {
          ticketId: ticket.id,
          // Absent when there is no message yet: storage-service omits the
          // segment rather than filling it with a placeholder.
          messageId: message?.id,
          contentType: request.mimeType,
          sizeBytes: request.fileSizeBytes,
          fileName: request.fileName,
        },
        context,
      );

      return {
        uploadUrl: presigned.uploadUrl,
        objectPath: presigned.objectPath,
        expiresAt: toProtoTimestamp(presigned.expiresAt),
      };
    } catch (error) {
      throw StorageReferenceService.asClientError(error);
    }
  }

  /**
   * Confirm, then write the row.
   *
   * The size and type stored are the ones storage-service read back from the
   * OBJECT, not the ones the client declared at presign — those were a hint for
   * the policy check, and a row built from them would record whatever the
   * client felt like claiming.
   */
  async confirmAttachment(
    request: ConfirmAttachmentRequest,
    context: CallerContext,
  ): Promise<AttachmentResponse> {
    const message = await this.loadMessage(
      request.ticketId,
      request.messageId,
      context,
    );

    let confirmed: Awaited<
      ReturnType<StorageReferenceService['confirmUpload']>
    >;
    try {
      confirmed = await this.storage.confirmUpload(request.objectPath, context);
    } catch (error) {
      throw StorageReferenceService.asClientError(error);
    }

    const attachment = await this.prisma.messageAttachment.create({
      data: {
        messageId: message.id,
        fileName: this.requireFileName(request.fileName),
        // An object PATH, never a URL. Reads resolve it to a fresh signed URL
        // per request, so revoking access takes effect on the NEXT read rather
        // than whenever a stored URL happens to expire.
        //
        // The CONFIRMED path — the object moved out of `pending/` on the way
        // through, so `request.objectPath` is where it no
        // longer is.
        fileUrl: confirmed.objectPath,
        fileSizeBytes: BigInt(confirmed.sizeBytes),
        mimeType: confirmed.contentType,
        // The same rule as the nested route, through the same helper — the
        // eligibility decision exists once, so the two paths cannot disagree
        // about which types get text.
        extractedText: await this.extractIfParseable(
          confirmed.objectPath,
          confirmed.contentType,
          context,
        ),
      },
    });

    return toAttachmentResponse(attachment);
  }

  async listAttachments(
    request: ListAttachmentsRequest,
    context: CallerContext,
  ): Promise<ListAttachmentsResponse> {
    const message = await this.loadMessage(
      request.ticketId,
      request.messageId,
      context,
    );

    const items = await this.prisma.messageAttachment.findMany({
      where: { messageId: message.id },
      orderBy: { createdAt: 'asc' },
    });

    return { items: items.map(toAttachmentResponse) };
  }

  /**
   * The ACL is re-checked HERE, before anything is signed.
   *
   * `message_attachments` has no tenant column of its own — it reaches one only
   * through message -> ticket -> organization — so a lookup by attachment id
   * alone would happily hand another tenant's file to whoever guessed its id.
   * The join back to a ticket the caller may see is the whole check, and it
   * runs BEFORE the storage call rather than being delegated to it, because
   * `storage-service` does not know this ticket's ACL and never will.
   */
  async downloadAttachment(
    request: DownloadAttachmentRequest,
    context: CallerContext,
  ): Promise<DownloadAttachmentResponse> {
    const attachment = await this.loadAttachment(request.attachmentId, context);

    const urls = await this.storage.resolveReadUrls(
      [attachment.fileUrl],
      context,
    );
    const downloadUrl = urls[attachment.fileUrl];

    if (!downloadUrl) {
      // The row exists but the object does not — a delete that outran its row,
      // or a bucket restored from a backup the database has moved past.
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'That file is no longer available',
      });
    }

    return {
      downloadUrl,
      expiresAt: toProtoTimestamp(new Date(Date.now() + READ_URL_GRACE_MS)),
    };
  }

  /**
   * A HARD delete, plus the async object removal.
   *
   * Attachments have no independent soft-delete story: they follow their
   * message, and a "deleted" attachment row that every listing had to remember
   * to filter would be a filter waiting to be forgotten. The FILE goes through
   * the same at-most-once supersede event everything else uses.
   */
  async deleteAttachment(
    request: DeleteAttachmentRequest,
    context: CallerContext,
  ): Promise<DeleteAttachmentResponse> {
    const attachment = await this.loadAttachment(request.attachmentId, context);

    if (!this.canModerate(context)) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message:
          'Removing an attachment requires the ticket.message.moderate permission',
      });
    }

    await this.prisma.messageAttachment.delete({
      where: { id: attachment.id },
    });

    // AFTER the commit. An object deleted before the row would leave a row
    // pointing at nothing if the delete then failed.
    this.storage.emitSuperseded(
      attachment.fileUrl,
      SupersededReason.RECORD_DELETED,
    );

    return {};
  }

  // -------------------------------------------------------------------------

  /**
   * The second write of `invokeAi`, isolated so its failure cannot reach the
   * first.
   */
  private async tryAppendAiReply(
    ticket: NotifiableTicket,
    context: CallerContext,
  ): Promise<void> {
    const { id: ticketId } = ticket;

    if (!this.rag.isAvailable) {
      this.logger.debug(
        `AI reply skipped for ticket ${ticketId}: rag-service is not configured`,
      );
      return;
    }

    try {
      // The thread so far, so the reply answers the conversation rather than
      // the last line of it. rag-service owns no conversation rows — a second
      // copy in a second database is a consistency problem nobody asked for.
      const history = await this.prisma.ticketMessage.findMany({
        // The same exclusion as the co-pilot's transcript. Two
        // Prisma readers, one clause each, and a refusal that reached only one
        // of them would be a defence on one surface and a delay on the other.
        where: { ticketId, excludedFromAiContext: false },
        // NEWEST first so `take` keeps the tail; reversed below into reading
        // order. `asc` here would take the first forty turns instead.
        orderBy: { createdAt: 'desc' },
        select: { content: true, senderId: true, isAiGenerated: true },
        take: AI_REPLY_TRANSCRIPT_TURNS,
      });
      history.reverse();

      // Same two decisions as the co-pilot path, made by the same service —
      // This one replies to a customer directly, so a screenshot it
      // could not see produces an answer about the text alone.
      const attachments = await this.aiAttachments.forLastUserMessage(
        ticketId,
        context,
      );

      const draft = await this.rag.generateReplyDraft(
        ticketId,
        history.map((message) => ({
          role:
            message.isAiGenerated || !message.senderId ? 'assistant' : 'user',
          content: message.content,
        })),
        context,
        // No review pass on this path. It appends a message to a
        // customer-visible thread rather than handing an agent a draft to
        // check, so the latency an agent would absorb is latency a customer
        // watches — and the review loop is for the surface where a
        // human reads before sending.
        0,
        attachments.parts,
      );

      const reply = await this.prisma.ticketMessage.create({
        data: {
          ticketId,
          // No sender. Attributing a generated message to a real person would
          // put words in their mouth in a permanent record.
          senderId: null,
          content: draft.content,
          isAiGenerated: true,
          modelName: draft.modelName,
          promptTokens: draft.promptTokens,
          completionTokens: draft.completionTokens,
          // This answer never reaches a socket, so the row is the only place
          // its references can live.
          citations: toStoredCitations(draft.citations),
        },
      });

      // **Do not add `recordOutcome` here.** This path books its generation as
      // `purpose=DRAFT`, inside the co-pilot acceptance rate, and its text
      // always equals the draft — so every call would record ACCEPTED and push
      // that rate toward 100%. See known-gaps #33.

      this.publishCreated(ticket, reply);
    } catch (error) {
      this.logger.error(
        `AI reply failed for ticket ${ticketId}: ${formatErrorMsg(error)}`,
      );

      // **The same write-back as the co-pilot path**, and the
      // reason it is here too: this surface auto-replies on every customer
      // message, so a refused question left in the transcript is re-sent to the
      // model on the customer's very next line.
      //
      // Swallowed like everything else in this handler. The caller's own
      // message is already committed and is what the RPC promises to return; a
      // failed bookkeeping write must not turn that into an error.
      await this.excludeRefused(ticketId, error);
    }
  }

  /**
   * Marks a refused message so it cannot reach a later prompt.
   *
   * **Only on an actual refusal.** A timeout, an outage or a cap are different
   * failures whose message is perfectly usable next time, and excluding on
   * those would shrink a thread's context whenever the provider had a bad
   * minute.
   */
  private async excludeRefused(
    ticketId: string,
    error: unknown,
  ): Promise<void> {
    if (!isDraftRefusal(error)) return;

    try {
      const messageId = await this.aiAttachments.lastUserMessageId(ticketId);
      if (!messageId) return;

      await this.prisma.ticketMessage.update({
        where: { id: messageId },
        data: { excludedFromAiContext: true },
      });
    } catch (writeError) {
      this.logger.error(
        `Could not exclude a refused message from AI context: ${formatErrorMsg(writeError)}`,
      );
    }
  }

  /**
   * Takes the TICKET, not just its tenant.
   *
   * The event now carries `requesterId` and `assigneeId` so Domain E can notify
   * *the other party* — the requester when an agent wrote it, the assignee when
   * the requester did — which is undecidable from `senderId` alone. Passing the
   * ticket here rather than re-reading it in the consumer is what keeps the
   * fan-out free of an RPC per message, and messages are the
   * highest-volume event in the system.
   */
  private publishCreated(
    ticket: NotifiableTicket,
    message: TicketMessage,
  ): void {
    this.events.publish({
      pattern: TICKET_PATTERNS.messageCreated,
      organizationId: ticket.organizationId,
      ticketId: message.ticketId,
      ticketNumber: Number(ticket.ticketNumber),
      occurredAt: new Date().toISOString(),
      messageId: message.id,
      senderId: message.senderId,
      requesterId: ticket.authorId,
      assigneeId: ticket.currentAssigneeId,
      isAiGenerated: message.isAiGenerated,
      isInternalNote: message.isInternalNote,
      // Computed by the shared helper, never assembled here. Domain E groups on
      // exact string equality, and a second spelling would produce a duplicate
      // notification group nobody would notice until a user complained.
      groupKey: ticketMessageGroupKey(message.ticketId),
    });
  }

  /**
   * Who may edit THIS message.
   *
   * Split out so both conditions are visible together — read as one `if`, the
   * moderator branch looks like it widens the sender branch, when in fact it is
   * a narrower, different right.
   */
  private assertMayEdit(message: TicketMessage, context: CallerContext): void {
    const actorId = requireActor(context);

    if (message.isInternalNote && this.canModerate(context)) return;

    if (message.senderId !== actorId) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Only the sender may edit a message',
      });
    }

    const deadline = new Date(
      message.createdAt.getTime() + this.editWindowMinutes * 60_000,
    );
    if (new Date() > deadline) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `A message can only be edited within ${this.editWindowMinutes} minutes of posting`,
      });
    }
  }

  /**
   * Queue access is what makes somebody an agent. A ticket's author holds none
   * of it and must not see the notes written ABOUT their ticket.
   *
   * Delegates rather than re-deriving: the status-change reason follows the
   * same rule, and two copies of "who is an agent" would be two things to keep
   * in step.
   */
  private canSeeInternalNotes(context: CallerContext): boolean {
    return this.access.isAgent(context);
  }

  private canModerate(context: CallerContext): boolean {
    return (
      context.isSuperAdmin ||
      context.permissionCodes.includes('ticket.message.moderate')
    );
  }

  private requireContent(content: string): string {
    const trimmed = content?.trim() ?? '';

    if (!trimmed) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A message cannot be empty',
      });
    }
    if (trimmed.length > MAX_MESSAGE_CONTENT_LENGTH) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `A message cannot exceed ${MAX_MESSAGE_CONTENT_LENGTH} characters`,
      });
    }

    return trimmed;
  }

  /**
   * An earlier message with this client id, or null.
   *
   * Scoped to the TICKET as well as the id, matching the index: uniqueness is
   * per ticket, so a client reusing an id across threads gets two messages
   * rather than one collision — which is right, since those are two intents.
   */
  private async findByClientMessageId(
    ticketId: string,
    clientMessageId: string,
  ): Promise<MessageWithAttachments | null> {
    return this.prisma.ticketMessage.findFirst({
      where: { ticketId, clientMessageId },
      include: { attachments: true },
    });
  }

  /**
   * A message on a ticket the caller may see — and subject to the SAME note
   * filter as the list.
   *
   * Without the filter here, a non-agent who guessed a note's id could read it
   * one at a time, which is the list endpoint's protection undone by a
   * different route.
   */
  private async loadMessage(
    ticketId: string,
    messageId: string,
    context: CallerContext,
  ): Promise<LoadedMessage> {
    const ticket = await this.tickets.load(ticketId, context);

    const message = await this.prisma.ticketMessage.findFirst({
      where: {
        id: messageId,
        ticketId: ticket.id,
        ...this.access.internalNoteScope(context),
      },
    });
    if (!message) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No message with that id on this ticket',
      });
    }

    // The TENANT rides along, taken from the ticket this already loaded.
    // `ticket_messages` has no `organization_id` of its own — it is scoped
    // through its ticket — and the edit and redaction events both need one. The
    // alternative is a second read of a row already in memory.
    return { ...message, organizationId: ticket.organizationId };
  }

  /**
   * An attachment on a ticket the caller may see, or NOT_FOUND.
   *
   * NOT_FOUND for both "no such attachment" and "not yours" — telling the two
   * apart turns id enumeration into a tenant-membership oracle.
   */
  private async loadAttachment(
    attachmentId: string,
    context: CallerContext,
  ): Promise<MessageAttachment> {
    const attachment = await this.prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: { select: { ticketId: true, isInternalNote: true } },
      },
    });

    if (
      !attachment ||
      (attachment.message.isInternalNote && !this.canSeeInternalNotes(context))
    ) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No attachment with that id',
      });
    }

    // Throws NOT_FOUND if the caller may not see the ticket it hangs off.
    await this.tickets.load(attachment.message.ticketId, context);

    return attachment;
  }

  private requireFileName(fileName: string): string {
    const trimmed = fileName?.trim() ?? '';
    if (!trimmed) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A file name is required',
      });
    }

    return trimmed.slice(0, 255);
  }
}
