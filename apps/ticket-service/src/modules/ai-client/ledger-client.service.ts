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
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/common';

/**
 * The acceptance loop's other end.
 *
 * `ai_generations` lives in `ingestion-service` and keeps ONE writer, so this
 * is a gRPC call rather than a reach into another service's database.
 *
 * **gRPC rather than an event, and that was settled rather than deferred**
 * (12-doc §1.2). Two reasons: the caller needs the classification in its own
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
   * Returns null when it could not be recorded, so a caller that wants to
   * surface the outcome can tell "not recorded" from "recorded as ACCEPTED".
   */
  async recordOutcome(
    generationId: string,
    resultingMessageId: string,
    sentText: string,
    context: CallerContext,
  ): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.ledger
          .recordGenerationOutcome(
            { generationId, resultingMessageId, sentText },
            packRequestContext(context),
          )
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return response.outcome;
    } catch (error) {
      this.logger.error(
        `Could not record the outcome for generation ${generationId}: ${formatErrorMsg(error)}`,
      );

      // The sweep will eventually mark it DISCARDED, which is WRONG for a
      // draft that was actually sent — and that is the honest cost of not
      // failing the user's request. Logged loudly because nothing else
      // surfaces it.
      return null;
    }
  }
}
