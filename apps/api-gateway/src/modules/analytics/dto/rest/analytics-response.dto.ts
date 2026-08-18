/**
 * The analytics response shapes. **REST only.**
 *
 * Three of these — `RateResponseDto`, `MeanResponseDto` and `OverviewResponseDto` — have GraphQL
 * counterparts in `./graphql/`, checked against them by
 * `analytics-response.contract.spec.ts`. Everything below `OverviewResponseDto` is the
 * chart series, which the schema does not serve at all: the schema keeps
 * analytics a whole-shape read rather than a resolvable graph.
 *
 * **Every rate carries its denominator, at every level.** A percentage with a
 * hidden denominator is how *"our CSAT is 100%"* reaches a board deck on two
 * responses, and the shape here makes that impossible to do accidentally: there
 * is no bare number to read.
 */

import {
  AiModelTier,
  AnalyticsExportKind,
  AnalyticsExportStatus,
  DocumentFlagType,
} from '@synapsedesk/common';

export class RateResponseDto {
  /** null when the denominator is zero — NOT zero. The two are different facts. */
  rate!: number | null;
  numerator!: number;
  denominator!: number;
}

export class MeanResponseDto {
  mean!: number | null;
  count!: number;
}

export class OverviewResponseDto {
  ticketsCreated!: number;
  ticketsResolved!: number;
  ticketsEscalated!: number;
  openTickets!: number;
  deflection!: RateResponseDto;
  csat!: RateResponseDto;
  /** Reported apart from the AI figure, always. */
  humanFirstResponseSeconds!: MeanResponseDto;
  aiFirstResponseSeconds!: MeanResponseDto;
  resolutionSeconds!: MeanResponseDto;
  /**
   * The counterweight to `resolutionSeconds`, which can only see tickets that
   * closed and is therefore biased optimistic.
   */
  openTicketMedianAgeSeconds!: number | null;
  /** When the rollups behind this answer ran. */
  computedAt!: Date | null;
  /**
   * **The last day the rollups behind this answer cover**,
   * `YYYY-MM-DD`, or `null` when no rollup has ever run for this tenant.
   *
   * Not the same as `computedAt`, and the gap between them is the diagnosis: a
   * recent `computedAt` beside a `dataThrough` two weeks old means the job runs
   * and finds nothing, while `dataThrough: null` means it has never run at all.
   * A dashboard of zeros looks identical in both cases without this field —
   * which is how seven scheduled jobs sat uncalled and nothing complained.
   */
  dataThrough!: string | null;
}

export class DeflectionPointResponseDto {
  day!: string;
  deflection!: RateResponseDto;
  chatConversations!: number;
  chatResolvedWithoutEscalation!: number;
}

export class DeflectionResponseDto {
  points!: DeflectionPointResponseDto[];
  total!: RateResponseDto;
  /** See `OverviewResponseDto.dataThrough`. */
  dataThrough!: string | null;
}

export class ResponseTimePointResponseDto {
  day!: string;
  humanFirstResponseSeconds!: MeanResponseDto;
  aiFirstResponseSeconds!: MeanResponseDto;
  resolutionSeconds!: MeanResponseDto;
}

export class ResponseTimesResponseDto {
  points!: ResponseTimePointResponseDto[];
  humanTotal!: MeanResponseDto;
  aiTotal!: MeanResponseDto;
  resolutionTotal!: MeanResponseDto;
  /** See `OverviewResponseDto.dataThrough`. */
  dataThrough!: string | null;
}

export class VolumePointResponseDto {
  day!: string;
  created!: number;
  resolved!: number;
  escalated!: number;
}

export class VolumeBreakdownResponseDto {
  key!: string;
  count!: number;
}

export class VolumeResponseDto {
  points!: VolumePointResponseDto[];
  byStatus!: VolumeBreakdownResponseDto[];
  byPriority!: VolumeBreakdownResponseDto[];
  bySource!: VolumeBreakdownResponseDto[];
  /** See `OverviewResponseDto.dataThrough`. */
  dataThrough!: string | null;
}

export class SatisfactionPointResponseDto {
  day!: string;
  csat!: RateResponseDto;
  citationAccuracy!: RateResponseDto;
}

export class SatisfactionResponseDto {
  points!: SatisfactionPointResponseDto[];
  csatTotal!: RateResponseDto;
  citationAccuracyTotal!: RateResponseDto;
  /** See `OverviewResponseDto.dataThrough`. */
  dataThrough!: string | null;
}

export class AiUsageSliceResponseDto {
  purpose!: string;
  modelName!: string;
  generations!: number;
  promptTokens!: number;
  completionTokens!: number;
  costMicros!: number;
  latencyMs!: MeanResponseDto;
  failureRate!: RateResponseDto;
}

export class AiUsagePointResponseDto {
  day!: string;
  generations!: number;
  costMicros!: number;
}

export class AiUsageResponseDto {
  points!: AiUsagePointResponseDto[];
  /** **The per-purpose split is the point** — where the budget actually goes. */
  byPurpose!: AiUsageSliceResponseDto[];
  byModel!: AiUsageSliceResponseDto[];
  totalCostMicros!: number;
  totalGenerations!: number;
  monthlyBudgetMicros!: number;
  /**
   * `FAST` | `QUALITY`, or null.
   *
   * The wire field was a bare `string` while `billing.proto` spelled the same
   * fact as `AiModelTier` — drift rather than a decision, and it is an enum on
   * both now. Null only for UNSPECIFIED, which means auth-service returned no
   * entitlement.
   */
  aiModelTier!: AiModelTier | null;
  draftAcceptance!: RateResponseDto;
  emptyRetrievalRate!: RateResponseDto;
  computedAt!: Date | null;
  /** See `OverviewResponseDto.dataThrough`. */
  dataThrough!: string | null;
}

/**
 * An agent row, with the name hydrated at this layer.
 *
 * ticket-service stores an agent id and has never known a display name (RDM
 * `auth-service` is a NAME SOURCE here, not an analytics source — the
 * distinction the ownership map blurs.
 */
export class AgentStatResponseDto {
  agentId!: string;
  /** null when the id could not be resolved — a deleted user, or a lookup that failed. */
  fullName!: string | null;
  assigned!: number;
  resolved!: number;
  messagesSent!: number;
  resolutionSeconds!: MeanResponseDto;
  /** From the AI ledger. null when that leg was unavailable. */
  draftAcceptance!: RateResponseDto | null;
}

/**
 * A block that could not be produced.
 *
 * **A dashboard where nine tiles render and one says "unavailable" is far more
 * useful than a 500**, and it is what someone diagnosing an incident actually
 * needs: the failure is localized to a service rather than to "analytics".
 */
export class UnavailableBlockResponseDto {
  /** Which leg failed, by service name. */
  source!: string;
  reason!: string;
}

export class AgentAnalyticsResponseDto {
  items!: AgentStatResponseDto[];

  /**
   * **The last day the underlying rollups cover**, `YYYY-MM-DD`,
   * or `null` when nothing has ever been rolled up.
   *
   * This endpoint spans more than one service, so it reports the STALEST leg:
   * a composed answer is only as fresh as its oldest input, and reporting the
   * freshest would let one healthy service vouch for a broken one.
   */
  dataThrough!: string | null;

  /** Which legs could not be reached. Empty when everything answered. */
  unavailable!: UnavailableBlockResponseDto[];
}

export class KnowledgeGapFlagResponseDto {
  documentId!: string;
  documentTitle!: string;
  flagType!: DocumentFlagType | null;
  detail!: string;
}

export class KnowledgeGapsResponseDto {
  emptyRetrievals!: number;
  answeringGenerations!: number;
  emptyRetrievalRate!: RateResponseDto;
  flags!: KnowledgeGapFlagResponseDto[];
  /** See `AgentAnalyticsResponseDto.dataThrough`. */
  dataThrough!: string | null;
  unavailable!: UnavailableBlockResponseDto[];
}

export class DocumentUsageResponseDto {
  documentId!: string;
  title!: string;
  retrievalCount!: number;
  citationCount!: number;
  chunkCount!: number;
}

export class DocumentAnalyticsResponseDto {
  mostCited!: DocumentUsageResponseDto[];
  /** **Two DIFFERENT findings** (RDM Table 27), never merged into one list. */
  neverRetrieved!: DocumentUsageResponseDto[];
  retrievedNeverCited!: DocumentUsageResponseDto[];
  /** Citation accuracy from `ai_response_feedbacks` — the other service's leg. */
  citationAccuracy!: RateResponseDto | null;
  /** See `AgentAnalyticsResponseDto.dataThrough`. */
  dataThrough!: string | null;
  unavailable!: UnavailableBlockResponseDto[];
}

export class AnalyticsExportResponseDto {
  id!: string;
  /**
   * The enums, where these were `string` with the members named in a comment.
   *
   * A comment listing `PENDING | READY | FAILED` is the arrangement the whole
   * pass exists to replace: it tells a reader the vocabulary and tells the
   * compiler nothing, and the Swagger plugin publishes `type: string` for a
   * field with exactly three values.
   */
  status!: AnalyticsExportStatus | null;
  kind!: AnalyticsExportKind | null;
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
