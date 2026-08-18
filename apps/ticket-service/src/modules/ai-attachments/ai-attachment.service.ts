import { Injectable, Logger } from '@nestjs/common';
import {
  AI_ELIGIBLE_MIME_TYPES,
  MAX_AI_ATTACHMENT_BYTES,
  formatErrorMsg,
} from '@synapsedesk/common';
import { AttachmentPart, CallerContext } from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';

/** What was sent, and what was not. */
export type AiAttachments = {
  parts: AttachmentPart[];
  /** File names left out, for telling the user. Never their contents. */
  skipped: string[];
};

/**
 * Attachments as model input.
 *
 * **One implementation for three call sites.** `Chat` is the gateway's,
 * co-pilot `Draft` and the `invokeAi` auto-reply are ticket-service's,
 * and all three need the same two decisions made the same way.
 * A copy per caller is three places for the eligibility rule to drift, on a
 * path where drift means either spending tokens on a zip or silently dropping
 * a screenshot.
 *
 * It lives HERE, in the service that owns `message_attachments`, because the
 * expensive half is avoidable only from the row: `mimeType` and
 * `fileSizeBytes` decide eligibility, so an ineligible file is rejected without
 * a download. A caller that fetched first and filtered after would work and
 * would pay for every zip a user ever attached.
 */
@Injectable()
export class AiAttachmentService {
  private readonly logger = new Logger(AiAttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageReferenceService,
  ) {}

  /**
   * The parts for one message, filtered then fetched.
   *
   * **Order is the whole design.** Eligibility comes off the row; only what
   * survives it costs a download.
   */
  async forMessage(
    messageId: string,
    context: CallerContext,
  ): Promise<AiAttachments> {
    const rows = await this.prisma.messageAttachment.findMany({
      // **The refusal exclusion reaches the FILES, not only the text** —
      //
      //
      // The three transcript builders drop a refused message's content; without
      // this clause its attachments still arrived. A user sends injection text
      // plus a screenshot, the guard refuses it, the write-back sets the flag —
      // and the next co-pilot draft excludes the sentence and sends the file.
      //
      // **Inverted with respect to risk, which is why it is here rather than
      // only in the selectors below.** The file is the half Layer A cannot read
      // at all and Layer B only classifies, so it is the half the exclusion most
      // needed to cover. Filtered through the relation so a caller that hands
      // in a message id directly — the gateway's `Chat` path — is covered by the
      // same clause as the two rules that select their own.
      where: { messageId, message: { excludedFromAiContext: false } },
      orderBy: { createdAt: 'asc' },
    });

    if (rows.length === 0) return { parts: [], skipped: [] };

    const parts: AttachmentPart[] = [];
    const skipped: string[] = [];
    let budget = MAX_AI_ATTACHMENT_BYTES;

    for (const row of rows) {
      const size = Number(row.fileSizeBytes);

      if (!this.isEligible(row.mimeType)) {
        // A zip is storable, downloadable and unreadable to the model. Sending
        // it would spend tokens to produce nothing.
        skipped.push(row.fileName);
        continue;
      }

      if (size > budget) {
        // **Skip this one and keep going**, rather than stopping. All-or-nothing
        // would drop a good screenshot because a large PDF happened to come
        // first, and a partial answer about what fitted is worth more than a
        // question answered blind.
        skipped.push(row.fileName);
        continue;
      }

      try {
        const data = await this.storage.downloadObject(row.fileUrl, context);
        parts.push({
          mimeType: row.mimeType,
          data,
          // The NAME travels, never the contents — it labels the boundary block
          // and appears in logs, both of which an operator reads.
          fileName: row.fileName,
        });
        budget -= size;
      } catch (error) {
        // A missing object must not fail the question. The user asked
        // something; answering it without one file beats answering nothing,
        // and the skip is reported either way.
        this.logger.warn(
          `Attachment ${row.id} could not be read: ${formatErrorMsg(error)}`,
        );
        skipped.push(row.fileName);
      }
    }

    return { parts, skipped };
  }

  /**
   * The parts for the last USER message on a ticket — both `Draft` paths.
   *
   * An agent asking for a suggested reply is replying to what the customer last
   * sent, and with inbound email that message can have arrived by email from
   * someone who never authenticated. That makes this the highest-trust position
   * an untrusted file reaches in this system, which is why the guard covers it.
   *
   *
   * AI messages are skipped rather than the newest row taken: the last message
   * on a busy ticket is often the assistant's own reply, which has no
   * attachments and would return empty for a customer screenshot one row above.
   */
  async forLastUserMessage(
    ticketId: string,
    context: CallerContext,
  ): Promise<AiAttachments> {
    // **Excluding refused ones**, which is what makes this differ from
    // `lastUserMessageId` below. A refused turn is not in the transcript this
    // draft is built from, so its files must not be either — and falling back
    // to the previous message means the attachments and the text the model sees
    // describe the same exchange.
    const messageId = await this.newestUserMessageId(ticketId, {
      excludingRefused: true,
    });
    if (!messageId) return { parts: [], skipped: [] };

    return this.forMessage(messageId, context);
  }

  /**
   * The parts for the ticket's EARLIEST message — `Classify`.
   *
   * The third of three selection rules: `Chat` sends the current message's
   * attachments, `Draft` the last user message's, and this one the first —
   * because `title` and `description` describe how the ticket opened, and
   * classify never reads anything later.
   *
   * **Nothing carries terms forward to this surface.** Classify reads neither
   * the replies nor the conversation, so a ticket whose body says "see
   * attached" routes on those two words unless the file is here.
   *
   * **Empty is the ordinary case for an emailed ticket**, and accepted:
   * `createTicket` writes a ticket row and no message. Classify is
   * agent-triggered, so a message usually exists by the time anyone clicks —
   * and re-running is one click.
   *
   * User messages only, like `forLastUserMessage`: an assistant reply carries
   * no attachments.
   *
   * See `docs/decisions/0030-refused-turns-exclude-their-attachments.md`.
   */
  async forEarliestMessage(
    ticketId: string,
    context: CallerContext,
  ): Promise<AiAttachments> {
    const message = await this.prisma.ticketMessage.findFirst({
      // **No exclusion clause, and it is NOT an oversight** — the refused
      // opening message is still the opening message.
      //
      // `forLastUserMessage` skips refused rows and falls back to the previous
      // one, because a draft's attachments should describe the same exchange
      // its transcript shows. This rule cannot borrow that: it selects the
      // EARLIEST message precisely because `title` and `description` describe
      // how the ticket opened, and a later message's files are not what they
      // describe. Falling back would answer a different question.
      //
      // So a refused opening message yields NOTHING rather than something
      // else — `forMessage` drops its files through the relation clause — and
      // a ticket that opened with an injection routes on its text alone, which
      // is where it started.
      where: { ticketId, isAiGenerated: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!message) return { parts: [], skipped: [] };

    return this.forMessage(message.id, context);
  }

  /**
   * The id of the message a draft is replying to.
   *
   * Public because the refusal write-back needs the same row this class already
   * resolves: when rag-service refuses a draft, what was refused is this
   * message, and it is the one that must not reach a later prompt. Two
   * definitions of "the last user message" would eventually disagree, and the
   * disagreement would be a refused question quietly staying in context.
   */
  async lastUserMessageId(ticketId: string): Promise<string | null> {
    // **Includes refused ones, deliberately** — the opposite of what
    // `forLastUserMessage` wants, which is why the two ask separately rather
    // than sharing a call.
    //
    // This resolves the message a refusal is about to be written back TO.
    // Skipping already-excluded rows would be wrong on a retry: the row it
    // wants is precisely the one a previous attempt already flagged.
    return this.newestUserMessageId(ticketId, { excludingRefused: false });
  }

  /**
   * The newest message a human wrote — with or without the refused ones.
   *
   * **One query, two questions, and the flag says which.** *"What is the draft
   * replying to"* and *"what was just refused"* are different questions about
   * the same table, and answering both from one unparameterised method is how
   * the refusal write-back and the attachment selector would silently agree to
   * be wrong in opposite directions.
   */
  private async newestUserMessageId(
    ticketId: string,
    { excludingRefused }: { excludingRefused: boolean },
  ): Promise<string | null> {
    const message = await this.prisma.ticketMessage.findFirst({
      where: {
        ticketId,
        isAiGenerated: false,
        ...(excludingRefused ? { excludedFromAiContext: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return message?.id ?? null;
  }

  private isEligible(mimeType: string): boolean {
    return (AI_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mimeType);
  }
}
