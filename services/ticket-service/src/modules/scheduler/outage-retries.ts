import { Injectable, Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import {
  PARSE_ELIGIBLE_MIME_TYPES,
  systemContext,
} from '@synapsedesk/contracts';
import { AttachmentExtractorClient } from '../ai-client/attachment-extractor.client';
import {
  isTransient,
  LedgerClientService,
} from '../ai-client/ledger-client.service';
import { PrismaService } from '../prisma/prisma.service';

/** How far back an attachment's failed extraction is retried, hourly. */
export const EXTRACTION_RETRY_HOURS = 24;

/** The code ingestion-service answers for a type it doesn't parse. */
const NEVER_PARSED: number = status.INVALID_ARGUMENT;

/** The most of each kind one run retries; the next hour takes the rest. */
export const RETRY_BATCH = 100;

/**
 * The two calls to ingestion-service an outage of it would otherwise lose,
 * tried again by `TICKET_HOURLY`. Both happen outside any rag call, so nothing
 * else retries them, and neither may block the user's action that made them.
 */
@Injectable()
export class OutageRetries {
  private readonly logger = new Logger(OutageRetries.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: AttachmentExtractorClient,
    private readonly ledger: LedgerClientService,
  ) {}

  /**
   * Extracts again each parse-eligible attachment confirmed in the last
   * {@link EXTRACTION_RETRY_HOURS} whose text is still missing.
   *
   * Every eligible attachment is attempted at its confirm, so `extracted_text
   * IS NULL` on one means that attempt failed. Retrying by age needs no other
   * state: a corrupt file costs at most 24 attempts, and an ingestion-service
   * outage of less than a day loses nothing. `INVALID_ARGUMENT` (a type
   * ingestion won't parse) is never retried into success, so it's only
   * logged. The AI reads the text from the hour it lands; until then it skips
   * the file, as any unreadable attachment.
   *
   * @returns how many attachments got their text.
   */
  async retryExtractions(now: Date = new Date()): Promise<number> {
    const since = new Date(now.getTime() - EXTRACTION_RETRY_HOURS * 3_600_000);
    const rows = await this.prisma
      .unscoped('cross-tenant job')
      .messageAttachment.findMany({
        where: {
          extractedText: null,
          mimeType: { in: [...PARSE_ELIGIBLE_MIME_TYPES] },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'asc' },
        take: RETRY_BATCH,
        select: {
          id: true,
          fileUrl: true,
          mimeType: true,
          ticket: { select: { organizationId: true } },
          message: { select: { ticket: { select: { organizationId: true } } } },
        },
      });

    let extracted = 0;
    for (const row of rows) {
      const organizationId =
        row.ticket?.organizationId ?? row.message?.ticket.organizationId;
      if (!organizationId) continue;

      const result = await this.extractor.attempt(
        row.fileUrl,
        row.mimeType,
        systemContext(organizationId),
      );
      if (result.ok) {
        // Only where still missing: a concurrent confirm-time write wins.
        const { count } = await this.prisma
          .unscoped('cross-tenant job')
          .messageAttachment.updateMany({
            where: { id: row.id, extractedText: null },
            data: { extractedText: result.markdown },
          });
        extracted += count;
      } else if (result.code === NEVER_PARSED) {
        this.logger.warn(
          `Attachment ${row.id} (${row.mimeType}) is not one ingestion-service parses; not retried into success`,
        );
      }
    }
    return extracted;
  }

  /**
   * Sends again each draft outcome `recordOutcome` kept when ingestion-service
   * didn't answer, with the text as sent.
   *
   * Deleted on success, and on a refusal no retry can change (`NOT_FOUND`,
   * `INVALID_ARGUMENT`, …), logged. Kept only while the failure is
   * `UNAVAILABLE`, a deadline, or no answer. A reply whose ticket is gone has
   * nothing left to attribute, so its row is deleted too.
   *
   * @returns how many outcomes were recorded.
   */
  async retryOutcomes(): Promise<number> {
    const rows = await this.prisma
      .unscoped('cross-tenant job')
      .pendingDraftOutcome.findMany({
        orderBy: { createdAt: 'asc' },
        take: RETRY_BATCH,
      });

    let recorded = 0;
    for (const row of rows) {
      const message = await this.prisma
        .unscoped('cross-tenant job')
        .ticketMessage.findUnique({
          where: { id: row.messageId },
          select: {
            ticketId: true,
            ticket: { select: { organizationId: true } },
          },
        });
      if (!message) {
        this.logger.warn(
          `Outcome of generation ${row.generationId} dropped: its reply ${row.messageId} is gone`,
        );
        await this.forget(row.generationId);
        continue;
      }

      const result = await this.ledger.send(
        row.generationId,
        row.messageId,
        row.sentText,
        message.ticketId,
        systemContext(message.ticket.organizationId),
      );
      if (result.ok) {
        await this.forget(row.generationId);
        recorded += 1;
      } else if (!isTransient(result.code)) {
        this.logger.warn(
          `Outcome of generation ${row.generationId} dropped: ingestion-service refused it (code ${result.code})`,
        );
        await this.forget(row.generationId);
      }
    }
    return recorded;
  }

  private async forget(generationId: string): Promise<void> {
    await this.prisma
      .unscoped('cross-tenant job')
      .pendingDraftOutcome.deleteMany({
        where: { generationId },
      });
  }
}
