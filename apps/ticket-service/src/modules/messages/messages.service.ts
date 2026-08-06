import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AttachmentResponse,
  CallerContext,
  ConfirmAttachmentRequest,
  CreateMessageRequest,
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
  toTimestamp,
  UpdateMessageRequest,
  UploadAttachmentRequest,
} from '@synapsedesk/grpc-proto';
import {
  formatErrorMsg,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_CONTENT_LENGTH,
  REDACTED_MESSAGE_PLACEHOLDER,
  requireActor,
  TICKET_MESSAGE_SORTABLE_FIELDS,
  TICKET_PATTERNS,
  SupersededReason,
  ticketMessageGroupKey,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketEventPublisher } from '../events/ticket-event.publisher';
import { TicketsService } from '../tickets/tickets.service';
import { RagClientService } from '../ai-client/rag-client.service';
import { LedgerClientService } from '../ai-client/ledger-client.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import {
  MessageAttachment,
  Prisma,
  TicketMessage,
} from '../../generated/prisma/client';
import { toAttachmentResponse, toMessageResponse } from './message.mapper';

/**
 * How long a download URL is advertised as valid.
 *
 * storage-service owns the real TTL; this is the value reported to the client,
 * deliberately a little SHORTER so a client that refreshes on expiry does so
 * before the URL actually dies rather than after.
 */
const READ_URL_GRACE_MS = 14 * 60 * 1000;

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
/**
 * How many messages the `invokeAi` reply path sends as context.
 *
 * The same bound the co-pilot uses and for the same reason: a long thread is
 * prompt tokens charged on every generation, and the tail is what the reply is
 * actually answering.
 */
const AI_REPLY_TRANSCRIPT_TURNS = 40;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  private readonly editWindowMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: TicketEventPublisher,
    private readonly tickets: TicketsService,
    private readonly rag: RagClientService,
    private readonly ledger: LedgerClientService,
    private readonly storage: StorageReferenceService,
    configService: ConfigService,
  ) {
    this.editWindowMinutes = configService.getOrThrow<number>(
      'MESSAGE_EDIT_WINDOW_MINUTES',
    );
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

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

    const where: Prisma.TicketMessageWhereInput = {
      ticketId: ticket.id,
      ...this.internalNoteScope(context),
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

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Post a message, and optionally ask for an AI draft.
   *
   * With `invokeAi` these are TWO separate writes, never one transaction. The
   * draft can legitimately fail — `rag-service` does not exist yet, and will
   * still be able to be down once it does — and rolling back would throw away
   * what the human actually typed because a machine could not answer them.
   */
  async createMessage(
    request: CreateMessageRequest,
    context: CallerContext,
  ): Promise<MessageResponse> {
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

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId,
        content,
        isInternalNote: request.isInternalNote,
      },
      include: { attachments: true },
    });

    this.publishCreated(ticket.organizationId, message);

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
      await this.tryAppendAiReply(ticket.organizationId, ticket.id, context);
    }

    return toMessageResponse(message);
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

    return { message: toMessageResponse(message) };
  }

  // -------------------------------------------------------------------------
  // Attachments — 10-storage-service.md §3.2
  // -------------------------------------------------------------------------

  /**
   * Presign an attachment upload.
   *
   * The per-message CAP is enforced HERE, before storage-service is called at
   * all — §3.2 test 1 asks for exactly that. Checking it downstream instead
   * would hand a caller who is already at the cap a perfectly usable upload
   * URL, and they would only discover the refusal after uploading the bytes.
   */
  async uploadAttachment(
    request: UploadAttachmentRequest,
    context: CallerContext,
  ): Promise<PresignAttachmentResponse> {
    const message = await this.loadMessage(
      request.ticketId,
      request.messageId,
      context,
    );

    const existing = await this.prisma.messageAttachment.count({
      where: { messageId: message.id },
    });
    if (existing >= MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments`,
      });
    }

    try {
      const presigned = await this.storage.presignAttachment(
        {
          ticketId: message.ticketId,
          messageId: message.id,
          contentType: request.mimeType,
          sizeBytes: request.fileSizeBytes,
          fileName: request.fileName,
        },
        context,
      );

      return {
        uploadUrl: presigned.uploadUrl,
        objectPath: presigned.objectPath,
        expiresAt: toTimestamp(presigned.expiresAt),
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

    let confirmed: { sizeBytes: number; contentType: string };
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
        fileUrl: request.objectPath,
        fileSizeBytes: BigInt(confirmed.sizeBytes),
        mimeType: confirmed.contentType,
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
      expiresAt: toTimestamp(new Date(Date.now() + READ_URL_GRACE_MS)),
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

  // -------------------------------------------------------------------------

  /**
   * The second write of `invokeAi`, isolated so its failure cannot reach the
   * first.
   */
  private async tryAppendAiReply(
    organizationId: string,
    ticketId: string,
    context: CallerContext,
  ): Promise<void> {
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
        where: { ticketId },
        orderBy: { createdAt: 'asc' },
        select: { content: true, senderId: true, isAiGenerated: true },
        take: AI_REPLY_TRANSCRIPT_TURNS,
      });

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
        // watches — and 13-doc §4.2's review loop is for the surface where a
        // human reads before sending.
        0,
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
        },
      });

      this.publishCreated(organizationId, reply);
    } catch (error) {
      this.logger.error(
        `AI reply failed for ticket ${ticketId}: ${formatErrorMsg(error)}`,
      );
    }
  }

  private publishCreated(organizationId: string, message: TicketMessage): void {
    this.events.publish({
      pattern: TICKET_PATTERNS.messageCreated,
      organizationId,
      ticketId: message.ticketId,
      occurredAt: new Date().toISOString(),
      messageId: message.id,
      senderId: message.senderId,
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
   * The internal-note filter, as a WHERE fragment.
   *
   * A fragment rather than a post-fetch `.filter()` on purpose, and §2.5 calls
   * this out specifically: filtering after the query leaks the notes' EXISTENCE
   * through the row count and the response timing, and leaves one forgotten
   * call site away from leaking the content itself.
   *
   * Returns `{}` for an agent so the caller can spread it unconditionally.
   */
  private internalNoteScope(
    context: CallerContext,
  ): Prisma.TicketMessageWhereInput {
    return this.canSeeInternalNotes(context) ? {} : { isInternalNote: false };
  }

  private canSeeInternalNotes(context: CallerContext): boolean {
    if (context.isSuperAdmin) return true;

    // Queue access is what makes somebody an agent. A ticket's author holds
    // neither of these and must not see the notes written ABOUT their ticket.
    return (
      context.permissionCodes.includes('ticket.read.all') ||
      context.permissionCodes.includes('ticket.message.moderate')
    );
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
  ): Promise<TicketMessage> {
    const ticket = await this.tickets.load(ticketId, context);

    const message = await this.prisma.ticketMessage.findFirst({
      where: {
        id: messageId,
        ticketId: ticket.id,
        ...this.internalNoteScope(context),
      },
    });
    if (!message) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No message with that id on this ticket',
      });
    }

    return message;
  }
}
