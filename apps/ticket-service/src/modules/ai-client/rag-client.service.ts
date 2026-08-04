import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

/** What a generated reply carries back, whoever eventually produces it. */
export type AiReplyDraft = {
  content: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
};

/**
 * A summary, WITHOUT token columns.
 *
 * `ai_summaries` has none in the RDM, and inventing them to match
 * `ticket_messages` would be forcing a parity the schema deliberately does not
 * claim — summaries are metered differently, or not yet specified. Adding the
 * columns now would mean guessing which.
 */
export type AiSummaryDraft = {
  summaryText: string;
  suggestedAction: string;
  confidenceScore: number;
  modelName: string;
};

export type AiSuggestion = {
  title: string;
  body: string;
  confidenceScore: number;
};

export type AiClassification = {
  suggestedDepartmentId: string;
  suggestedPriority: string;
  confidenceScore: number;
};

export type SimilarTicket = {
  ticketId: string;
  ticketNumber: number;
  title: string;
  similarityScore: number;
};

/**
 * The seam where `rag-service` will plug in — §1.7.
 *
 * `rag-service` is Python and does not exist yet. The contract is built now so
 * Domain C is a service swap rather than new plumbing, and until then every
 * call answers UNAVAILABLE.
 *
 * UNAVAILABLE (-> 503) rather than a 500 or a silent no-op, and the difference
 * matters to a client: 503 says "this feature is not up", which is true and
 * retryable; 500 says "we have a bug", which would send someone debugging
 * something that was never built. A silent no-op would be worst — the caller
 * would believe an AI reply was coming and wait for one that never arrives.
 */
@Injectable()
export class RagClientService {
  private readonly logger = new Logger(RagClientService.name);

  private readonly serviceUrl?: string;

  constructor(configService: ConfigService) {
    // Optional on purpose: making it required would mean ticket-service could
    // not boot until Domain C shipped, which would hold the whole support
    // engine hostage to a feature nobody has started.
    this.serviceUrl = configService.get<string>('RAG_SERVICE_URL');
  }

  /** Whether a call would do anything — lets a caller skip it rather than catch. */
  get isAvailable(): boolean {
    return Boolean(this.serviceUrl);
  }

  generateReplyDraft(): Promise<AiReplyDraft> {
    return this.unavailable('AI reply drafting');
  }

  generateSummary(): Promise<AiSummaryDraft> {
    return this.unavailable('AI summarization');
  }

  getSuggestions(): Promise<AiSuggestion[]> {
    return this.unavailable('AI suggestions');
  }

  classifyTicket(): Promise<AiClassification> {
    return this.unavailable('AI classification');
  }

  listSimilarTickets(): Promise<SimilarTicket[]> {
    return this.unavailable('Similar-ticket search');
  }

  /**
   * Every stub funnels here, so there is ONE message shape and one place to
   * delete when `rag-service` lands.
   */
  private unavailable(capability: string): Promise<never> {
    this.logger.debug(`${capability} requested, but RAG_SERVICE_URL is unset`);

    return Promise.reject(
      new RpcException({
        code: status.UNAVAILABLE,
        message: `${capability} is not yet available`,
      }),
    );
  }
}
