/**
 * The analytics response shapes — 19-doc §3.
 *
 * **Every rate carries its denominator, at every level.** A percentage with a
 * hidden denominator is how *"our CSAT is 100%"* reaches a board deck on two
 * responses, and the shape here makes that impossible to do accidentally: there
 * is no bare number to read.
 */
export class RateDto {
  /** null when the denominator is zero — NOT zero. The two are different facts. */
  rate!: number | null;
  numerator!: number;
  denominator!: number;
}

export class MeanDto {
  mean!: number | null;
  count!: number;
}

export class OverviewDto {
  ticketsCreated!: number;
  ticketsResolved!: number;
  ticketsEscalated!: number;
  openTickets!: number;
  deflection!: RateDto;
  csat!: RateDto;
  /** Reported apart from the AI figure, always. */
  humanFirstResponseSeconds!: MeanDto;
  aiFirstResponseSeconds!: MeanDto;
  resolutionSeconds!: MeanDto;
  /**
   * The counterweight to `resolutionSeconds`, which can only see tickets that
   * closed and is therefore biased optimistic.
   */
  openTicketMedianAgeSeconds!: number | null;
  /** When the rollups behind this answer ran. */
  computedAt!: Date | null;
}

export class DeflectionPointDto {
  day!: string;
  deflection!: RateDto;
  chatConversations!: number;
  chatResolvedWithoutEscalation!: number;
}

export class DeflectionDto {
  points!: DeflectionPointDto[];
  total!: RateDto;
}

export class ResponseTimePointDto {
  day!: string;
  humanFirstResponseSeconds!: MeanDto;
  aiFirstResponseSeconds!: MeanDto;
  resolutionSeconds!: MeanDto;
}

export class ResponseTimesDto {
  points!: ResponseTimePointDto[];
  humanTotal!: MeanDto;
  aiTotal!: MeanDto;
  resolutionTotal!: MeanDto;
}

export class VolumePointDto {
  day!: string;
  created!: number;
  resolved!: number;
  escalated!: number;
}

export class VolumeBreakdownDto {
  key!: string;
  count!: number;
}

export class VolumeDto {
  points!: VolumePointDto[];
  byStatus!: VolumeBreakdownDto[];
  byPriority!: VolumeBreakdownDto[];
  bySource!: VolumeBreakdownDto[];
}

export class SatisfactionPointDto {
  day!: string;
  csat!: RateDto;
  citationAccuracy!: RateDto;
}

export class SatisfactionDto {
  points!: SatisfactionPointDto[];
  csatTotal!: RateDto;
  citationAccuracyTotal!: RateDto;
}

export class AiUsageSliceDto {
  purpose!: string;
  modelName!: string;
  generations!: number;
  promptTokens!: number;
  completionTokens!: number;
  costMicros!: number;
  latencyMs!: MeanDto;
  failureRate!: RateDto;
}

export class AiUsagePointDto {
  day!: string;
  generations!: number;
  costMicros!: number;
}

export class AiUsageDto {
  points!: AiUsagePointDto[];
  /** **The per-purpose split is the point** — where the budget actually goes. */
  byPurpose!: AiUsageSliceDto[];
  byModel!: AiUsageSliceDto[];
  totalCostMicros!: number;
  totalGenerations!: number;
  monthlyBudgetMicros!: number;
  aiModelTier!: string;
  draftAcceptance!: RateDto;
  emptyRetrievalRate!: RateDto;
  computedAt!: Date | null;
}

/**
 * An agent row, with the name hydrated at this layer.
 *
 * ticket-service stores an agent id and has never known a display name (RDM
 * §1.13). auth-service is a NAME SOURCE here, not an analytics source — the
 * distinction the ownership map blurs and 19-doc §1 corrects.
 */
export class AgentStatDto {
  agentId!: string;
  /** null when the id could not be resolved — a deleted user, or a lookup that failed. */
  fullName!: string | null;
  assigned!: number;
  resolved!: number;
  messagesSent!: number;
  resolutionSeconds!: MeanDto;
  /** From the AI ledger. null when that leg was unavailable. */
  draftAcceptance!: RateDto | null;
}

/**
 * A block that could not be produced — 19-doc §3.2.
 *
 * **A dashboard where nine tiles render and one says "unavailable" is far more
 * useful than a 500**, and it is what someone diagnosing an incident actually
 * needs: the failure is localised to a service rather than to "analytics".
 */
export class UnavailableBlockDto {
  /** Which leg failed, by service name. */
  source!: string;
  reason!: string;
}

export class AgentAnalyticsDto {
  items!: AgentStatDto[];
  /** Empty when everything answered. */
  unavailable!: UnavailableBlockDto[];
}

export class KnowledgeGapFlagDto {
  documentId!: string;
  documentTitle!: string;
  flagType!: string;
  detail!: string;
}

export class KnowledgeGapsDto {
  emptyRetrievals!: number;
  answeringGenerations!: number;
  emptyRetrievalRate!: RateDto;
  flags!: KnowledgeGapFlagDto[];
  unavailable!: UnavailableBlockDto[];
}

export class DocumentUsageDto {
  documentId!: string;
  title!: string;
  retrievalCount!: number;
  citationCount!: number;
  chunkCount!: number;
}

export class DocumentAnalyticsDto {
  mostCited!: DocumentUsageDto[];
  /** **Two DIFFERENT findings** (RDM Table 27), never merged into one list. */
  neverRetrieved!: DocumentUsageDto[];
  retrievedNeverCited!: DocumentUsageDto[];
  /** Citation accuracy from `ai_response_feedbacks` — the other service's leg. */
  citationAccuracy!: RateDto | null;
  unavailable!: UnavailableBlockDto[];
}

export class AnalyticsExportDto {
  id!: string;
  /** PENDING | READY | FAILED. */
  status!: string;
  kind!: string;
  rowCount!: number | null;
  /**
   * The newest rollup run behind the file — the disputed-number guard.
   *
   * Two people exporting "last quarter" a week apart can see whether the data
   * was recomputed between them rather than guessing.
   */
  rollupComputedAt!: Date | null;
  /**
   * Present only while READY, and minted per request.
   *
   * A signed URL to a tenant's full ticket history is a credential, so it is
   * never stored — which is also why polling twice yields two different URLs.
   */
  downloadUrl!: string | null;
  error!: string | null;
  createdAt!: Date;
  completedAt!: Date | null;
}
