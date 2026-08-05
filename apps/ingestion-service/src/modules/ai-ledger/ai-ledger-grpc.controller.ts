import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  AiLedgerServiceController,
  AiLedgerServiceControllerMethods,
  RecordGenerationOutcomeRequest,
  RecordGenerationOutcomeResponse,
  RecordGenerationRequest,
  RecordGenerationResponse,
} from '@synapsedesk/grpc-proto';
import { AiGenerationPurpose, AiGenerationStatus } from '@synapsedesk/common';
import { AiLedgerService } from './ai-ledger.service';

/**
 * The ledger's remote write path — `ai_generations` keeps ONE writer.
 *
 * `rag-service` (Python) and `ticket-service` both produce spend and neither
 * reaches into postgres_ingestion to record it. Service-per-database means the
 * table has exactly one owner, and this is how the other two ask that owner to
 * write.
 *
 * **No tenant check on the context here, and that is deliberate:** the
 * organization id is a FIELD of the request rather than something read from
 * metadata, because the caller is often doing system work with no user at all —
 * an ingestion embedding, a scheduled sweep. What protects this surface is that
 * it is service-to-service only and never routed by the gateway.
 */
@Controller()
@AiLedgerServiceControllerMethods()
export class AiLedgerGrpcController implements AiLedgerServiceController {
  constructor(private readonly ledger: AiLedgerService) {}

  /**
   * Returns the id SYNCHRONOUSLY while the row is still being written.
   *
   * The caller needs an id to hand back to a client — it becomes
   * `generatedFromId` on the reply that closes the acceptance loop — and
   * blocking on the write would make bookkeeping a latency cost on a path that
   * has already spent the money.
   */
  recordGeneration(request: RecordGenerationRequest): RecordGenerationResponse {
    const generationId = this.ledger.record({
      organizationId: request.organizationId,
      userId: request.userId ?? null,
      ticketId: request.ticketId ?? null,
      purpose: request.purpose as AiGenerationPurpose,
      modelName: request.modelName,
      promptTokens: request.promptTokens,
      completionTokens: request.completionTokens,
      latencyMs: request.latencyMs,
      status: request.status as AiGenerationStatus,
      content: request.content ?? null,
      retrievedChunkIds: request.retrievedChunkIds,
      citedChunkIds: request.citedChunkIds,
    });

    return { generationId };
  }

  /**
   * The acceptance loop's other end — `ticket-service` calls this when an agent
   * posts a draft-derived reply.
   *
   * Awaited rather than fire-and-forget, unlike `recordGeneration`: this is an
   * UPDATE to an existing row and the caller needs the classification in its
   * own response. That is precisely why it is a gRPC call rather than an event
   * (12-doc §1.2).
   */
  async recordGenerationOutcome(
    request: RecordGenerationOutcomeRequest,
  ): Promise<RecordGenerationOutcomeResponse> {
    if (!request.generationId || !request.resultingMessageId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A generation id and a resulting message id are both required',
      });
    }

    const outcome = await this.ledger.recordOutcome(
      request.generationId,
      request.resultingMessageId,
      request.sentText,
    );

    return { outcome };
  }
}
