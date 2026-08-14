import { Injectable, Logger } from '@nestjs/common';
import {
  AI_ELIGIBLE_MIME_TYPES,
  MAX_AI_ATTACHMENT_BYTES,
  formatErrorMsg,
} from '@synapsedesk/common';
import { AttachmentPart, CallerContext } from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';

/** What was sent, and what was not — 36-doc §2.2. */
export type AiAttachments = {
  parts: AttachmentPart[];
  /** File names left out, for telling the user. Never their contents. */
  skipped: string[];
};

/**
 * Attachments as model input — 36-doc §2.
 *
 * **One implementation for three call sites.** `Chat` is the gateway's,
 * co-pilot `Draft` and the `invokeAi` auto-reply are ticket-service's
 * (35-doc §4.1), and all three need the same two decisions made the same way.
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
      where: { messageId },
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
   * sent, and after 31-doc/32-doc that message can have arrived by email from
   * someone who never authenticated. That makes this the highest-trust position
   * an untrusted file reaches in this system, which is why the guard covers it
   * (36-doc §4).
   *
   * AI messages are skipped rather than the newest row taken: the last message
   * on a busy ticket is often the assistant's own reply, which has no
   * attachments and would return empty for a customer screenshot one row above.
   */
  async forLastUserMessage(
    ticketId: string,
    context: CallerContext,
  ): Promise<AiAttachments> {
    const messageId = await this.lastUserMessageId(ticketId);
    if (!messageId) return { parts: [], skipped: [] };

    return this.forMessage(messageId, context);
  }

  /**
   * The id of the message a draft is replying to — 36-doc §7.
   *
   * Public because the refusal write-back needs the same row this class already
   * resolves: when rag-service refuses a draft, what was refused is this
   * message, and it is the one that must not reach a later prompt. Two
   * definitions of "the last user message" would eventually disagree, and the
   * disagreement would be a refused question quietly staying in context.
   */
  async lastUserMessageId(ticketId: string): Promise<string | null> {
    const message = await this.prisma.ticketMessage.findFirst({
      where: { ticketId, isAiGenerated: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return message?.id ?? null;
  }

  private isEligible(mimeType: string): boolean {
    return (AI_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mimeType);
  }
}
