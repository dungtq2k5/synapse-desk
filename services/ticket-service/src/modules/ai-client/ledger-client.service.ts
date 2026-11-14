import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AI_LEDGER_SERVICE_NAME,
  AiLedgerServiceClient,
  CallerContext,
  GRPC_DEADLINE_MS,
  INGESTION_GRPC_CLIENT,
  packRequestContext,
  fromProtoAiGenerationOutcome,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import { status } from '@grpc/grpc-js';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The acceptance loop's other end.
 *
 * `ai_generations` lives in `ingestion-service` and keeps ONE writer, so this
 * is a gRPC call rather than a reach into another service's database.
 *
 * **gRPC rather than an event, and that was settled rather than deferred**
 *. Two reasons: the caller needs the classification in its own
 * response, and this is an UPDATE to an existing row rather than an append of
 * new spend — so at-least-once delivery buys nothing and a queue's ordering
 * ambiguity is a liability. NATS remains correct for spend writes, which are
 * appends and genuinely fire-and-forget.
 */
@Injectable()
export class LedgerClientService implements OnModuleInit {
  private readonly logger = new Logger(LedgerClientService.name);

  private ledger!: AiLedgerServiceClient;

  constructor(
    @Inject(INGESTION_GRPC_CLIENT) private readonly client: ClientGrpc,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.ledger = this.client.getService<AiLedgerServiceClient>(
      AI_LEDGER_SERVICE_NAME,
    );
  }

  /**
   * Records what the agent did with a draft. **Never throws.**
   *
   * The message is already sent and the user has already seen it. Failing the
   * request because a metric could not be recorded would cost them their reply
   * to protect a number — exactly the wrong trade, and the same reasoning that
   * makes the ledger's own `record()` non-throwing.
   *
   * **Kept for a retry when ingestion-service didn't answer.** An outage
   * (`UNAVAILABLE`, a deadline) would otherwise lose the outcome for good: the
   * reply keeps no record of its draft, and ingestion's 24-hour sweep would
   * mark it DISCARDED. So the outcome is written to `pending_draft_outcomes`
   * with the text as sent, and `TICKET_HOURLY` sends it again. A refusal no
   * retry can change (`NOT_FOUND` for a generation that's gone) is only logged.
   *
   * Returns null when it could not be recorded, so a caller that wants to
   * surface the outcome can tell "not recorded" from "recorded as ACCEPTED".
   */
  async recordOutcome(
    generationId: string,
    resultingMessageId: string,
    sentText: string,
    context: CallerContext,
  ): Promise<string | null> {
    const result = await this.send(
      generationId,
      resultingMessageId,
      sentText,
      context,
    );
    if (result.ok) return result.outcome;

    if (isTransient(result.code)) {
      try {
        await this.prisma.pendingDraftOutcome.upsert({
          where: { generationId },
          create: { generationId, messageId: resultingMessageId, sentText },
          update: { messageId: resultingMessageId, sentText },
        });
      } catch (error) {
        this.logger.error(
          `Could not keep the outcome of generation ${generationId} for a retry: ${formatErrorMsg(error)}`,
        );
      }
    }
    return null;
  }

  /**
   * One attempt at recording an outcome, saying how it failed: the gRPC code
   * ingestion-service answered, or `null` when none came back (a local
   * timeout). Never throws; used by `recordOutcome` and by the hourly retry.
   *
   * @example
   * const result = await ledger.send(generationId, messageId, text, ctx);
   * if (!result.ok && isTransient(result.code)) keepForLater();
   */
  async send(
    generationId: string,
    resultingMessageId: string,
    sentText: string,
    context: CallerContext,
  ): Promise<OutcomeAttempt> {
    try {
      const response = await firstValueFrom(
        this.ledger
          .recordGenerationOutcome(
            { generationId, resultingMessageId, sentText },
            packRequestContext(context),
          )
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return {
        ok: true,
        outcome: fromProtoAiGenerationOutcome(response.outcome),
      };
    } catch (error) {
      this.logger.error(
        `Could not record the outcome for generation ${generationId}: ${formatErrorMsg(error)}`,
      );
      const code = (error as { code?: unknown } | null)?.code;

      return { ok: false, code: typeof code === 'number' ? code : null };
    }
  }
}

/** One outcome write's result: the outcome, or the gRPC code it failed with. */
export type OutcomeAttempt =
  { ok: true; outcome: string | null } | { ok: false; code: number | null };

/**
 * Whether a failed call is worth trying again: ingestion-service didn't
 * answer (`UNAVAILABLE`, `DEADLINE_EXCEEDED`) or no answer came back in time
 * (`null`, a local timeout). Anything else is the service saying no.
 *
 * @example
 * isTransient(status.UNAVAILABLE) // true
 * isTransient(status.NOT_FOUND)   // false
 */
export function isTransient(code: number | null): boolean {
  return code === null || TRANSIENT_CODES.has(code);
}

const TRANSIENT_CODES = new Set<number>([
  status.UNAVAILABLE,
  status.DEADLINE_EXCEEDED,
]);
