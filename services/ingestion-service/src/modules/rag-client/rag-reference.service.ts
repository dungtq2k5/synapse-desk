import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  ConflictPassage,
  JudgeConflictResponse,
  RAG_GRPC_CLIENT,
  RAG_SERVICE_NAME,
  RagServiceClient,
} from '@synapsedesk/grpc-proto';

/**
 * How long one judge call may take. Longer than the shared gRPC deadline: it
 * is a generation, not a lookup, and the check runs in the background.
 */
const JUDGE_DEADLINE_MS = 60_000;

/** rag-service, as the conflict check calls it. */
@Injectable()
export class RagReferenceService implements OnModuleInit {
  private ragService!: RagServiceClient;

  constructor(@Inject(RAG_GRPC_CLIENT) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.ragService =
      this.client.getService<RagServiceClient>(RAG_SERVICE_NAME);
  }

  /**
   * Whether two passages from different documents disagree.
   *
   * Called as the system: the tenant is a field of the request, and no caller
   * context is sent. Throws at the AI cap (rag-service refuses) and on any
   * failure; the conflict check treats both as "stop, leave it unchecked".
   *
   * @example
   * await rag.judgeConflict(organizationId,
   *   { documentTitle: 'Leave Policy', text: 'Carryover is 5 days.' },
   *   { documentTitle: 'Handbook', text: 'Carryover is 10 days.' })
   * // { conflicting: true, confidence: 0.9, detail: 'Leave Policy says …' }
   */
  judgeConflict(
    organizationId: string,
    first: ConflictPassage,
    second: ConflictPassage,
  ): Promise<JudgeConflictResponse> {
    return firstValueFrom(
      this.ragService
        .judgeConflict({ organizationId, first, second })
        .pipe(timeout(JUDGE_DEADLINE_MS)),
    );
  }
}
