import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { Metadata } from '@grpc/grpc-js';
import {
  AiJobHealthResponse,
  toProtoTimestamp,
  AiLedgerServiceController,
  AiLedgerServiceControllerMethods,
  AiUsageRequest,
  AiUsageResponse,
  DocumentAnalyticsRequest,
  DocumentAnalyticsResponse,
  KnowledgeGapsRequest,
  KnowledgeGapsResponse,
  RecordGenerationOutcomeRequest,
  RecordGenerationOutcomeResponse,
  RecordGenerationRequest,
  RecordGenerationResponse,
  RunAiRollupRequest,
  RunAiRollupResponse,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import {
  AiGenerationPurpose,
  AiGenerationStatus,
  JobHealthService,
} from '@synapsedesk/common';
import { AiLedgerService } from './ai-ledger.service';
import { AiAnalyticsService } from '../analytics/ai-analytics.service';
import { AiGenerationRollupJob } from '../analytics/ai-generation-rollup.job';

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
  constructor(
    private readonly ledger: AiLedgerService,
    private readonly analytics: AiAnalyticsService,
    private readonly rollup: AiGenerationRollupJob,
    private readonly jobHealth: JobHealthService,
  ) {}

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
  // ------------------------------------------------- 19-doc §3.2, the reads

  /**
   * Spend and quality, from the DAILY ROLLUP.
   *
   * On this controller rather than its own because it reads the ledger's
   * projection and shares nothing else in the service — a second gRPC service
   * for three read RPCs would be a second entry in every client's service map
   * for no boundary it does not already have.
   */
  getAiUsage(
    request: AiUsageRequest,
    metadata?: Metadata,
  ): Promise<AiUsageResponse> {
    return this.analytics.getAiUsage(request, unpackCallerContext(metadata));
  }

  getKnowledgeGaps(
    request: KnowledgeGapsRequest,
    metadata?: Metadata,
  ): Promise<KnowledgeGapsResponse> {
    return this.analytics.getKnowledgeGaps(
      request,
      unpackCallerContext(metadata),
    );
  }

  getDocumentAnalytics(
    request: DocumentAnalyticsRequest,
    metadata?: Metadata,
  ): Promise<DocumentAnalyticsResponse> {
    return this.analytics.getDocumentAnalytics(
      request,
      unpackCallerContext(metadata),
    );
  }

  /**
   * Platform-operated, and the ordering constraint is the whole risk here.
   *
   * This rollup reads rows retention deletes, so it must run BEFORE retention
   * over the same window (19-doc §2.2). Exposed so the recovery path is
   * reachable at all: once retention has eaten the raw rows, a backfill is the
   * only way a mistake in this job can ever be corrected.
   */
  async runAiRollup(request: RunAiRollupRequest): Promise<RunAiRollupResponse> {
    const outcome =
      request.from && request.to
        ? await this.rollup.backfill(
            new Date(`${request.from}T00:00:00.000Z`),
            new Date(`${request.to}T00:00:00.000Z`),
          )
        : await this.rollup.run();

    return { tenants: outcome.tenants, rows: outcome.rows };
  }

  /**
   * The heartbeat — 20-doc §4.4.
   *
   * Every row, unjudged. The staleness decision needs the list of jobs this
   * build EXPECTS, because a job that never ran has no row to return — which is
   * the exact case that made seven uncalled jobs invisible.
   */
  async getAiJobHealth(): Promise<AiJobHealthResponse> {
    const rows = await this.jobHealth.list();

    return {
      items: rows.map((row) => ({
        jobName: row.jobName,
        lastStartedAt: row.lastStartedAt
          ? toProtoTimestamp(row.lastStartedAt)
          : undefined,
        lastSucceededAt: row.lastSucceededAt
          ? toProtoTimestamp(row.lastSucceededAt)
          : undefined,
        lastDurationMs: row.lastDurationMs ?? undefined,
        lastError: row.lastError ?? undefined,
        consecutiveFailures: row.consecutiveFailures,
      })),
    };
  }
}
