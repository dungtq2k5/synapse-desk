/** Wire <-> REST conversions for the analytics surface. */

import {
  AnalyticsExportKind as ProtoAnalyticsExportKind,
  AnalyticsExportStatus as ProtoAnalyticsExportStatus,
  AnalyticsRangeRequest,
  fromProtoAnalyticsExportKind,
  fromProtoAnalyticsExportStatus,
  fromProtoTimestamp,
  type ProtoTimestamp,
  AiUsageResponse,
  fromProtoAiModelTier,
  DeflectionResponse,
  OverviewResponse,
  ResponseTimesResponse,
  SatisfactionResponse,
  VolumeResponse,
} from '@synapsedesk/grpc-proto';
import { AnalyticsRangeQueryDto } from './dto/rest/analytics.dto';
import {
  AiUsageResponseDto,
  AiUsageSliceResponseDto,
  AnalyticsExportResponseDto,
  DeflectionResponseDto,
  MeanResponseDto,
  OverviewResponseDto,
  RateResponseDto,
  ResponseTimesResponseDto,
  SatisfactionResponseDto,
  VolumeResponseDto,
} from './dto/rest/analytics-response.dto';

/**
 * The REST query -> the proto request every range endpoint takes.
 *
 * Annotated rather than inferred: the shape is a CONTRACT with six RPCs, and an
 * inferred anonymous object silently accepts a renamed or dropped field until
 * the service reads `undefined` and returns an empty chart.
 */
export function toAnalyticsRangeRequest(
  query: AnalyticsRangeQueryDto,
): AnalyticsRangeRequest {
  return {
    from: query.from,
    to: query.to,
    departmentId: query.departmentId,
    granularity: query.granularity,
  };
}

/** `undefined` → null, never → 0. A missing rate is not a rate of zero. */
export function toRateResponseDto(value?: {
  rate?: number;
  numerator: number;
  denominator: number;
}): RateResponseDto {
  return {
    rate: value?.rate ?? null,
    numerator: value?.numerator ?? 0,
    denominator: value?.denominator ?? 0,
  };
}

export function toMeanResponseDto(value?: {
  mean?: number;
  count: number;
}): MeanResponseDto {
  return { mean: value?.mean ?? null, count: value?.count ?? 0 };
}

export function toAiUsageSliceResponseDto(slice: {
  purpose: string;
  modelName: string;
  generations: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMs?: { mean?: number; count: number };
  failureRate?: { rate?: number; numerator: number; denominator: number };
}): AiUsageSliceResponseDto {
  return {
    purpose: slice.purpose,
    modelName: slice.modelName,
    generations: slice.generations,
    promptTokens: slice.promptTokens,
    completionTokens: slice.completionTokens,
    costMicros: slice.costMicros,
    latencyMs: toMeanResponseDto(slice.latencyMs),
    failureRate: toRateResponseDto(slice.failureRate),
  };
}

/**
 * The timestamps are typed, not `unknown`.
 *
 * They were declared `unknown` and then handed to `fromProtoTimestamp` through
 * `as never` — a cast that says "trust me" about the one thing the parameter
 * type had just refused to state. `ProtoTimestamp` is exported for exactly this,
 * so naming it costs nothing and makes a wrong wire shape a compile error here
 * rather than a `new Date(NaN)` in a report.
 */
export function toAnalyticsExportResponseDto(response: {
  id: string;
  status: ProtoAnalyticsExportStatus;
  kind: ProtoAnalyticsExportKind;
  rowCount?: number;
  rollupComputedAt?: ProtoTimestamp;
  downloadUrl?: string;
  error?: string;
  createdAt?: ProtoTimestamp;
  completedAt?: ProtoTimestamp;
}): AnalyticsExportResponseDto {
  return {
    id: response.id,
    status: fromProtoAnalyticsExportStatus(response.status),
    kind: fromProtoAnalyticsExportKind(response.kind),
    rowCount: response.rowCount ?? null,
    rollupComputedAt: fromProtoTimestamp(response.rollupComputedAt) ?? null,
    downloadUrl: response.downloadUrl ?? null,
    error: response.error ?? null,
    createdAt: fromProtoTimestamp(response.createdAt) ?? new Date(0),
    completedAt: fromProtoTimestamp(response.completedAt) ?? null,
  };
}

/** Converts a `OverviewResponse` off the wire into its REST DTO. */
export function toOverviewResponseDto(
  response: OverviewResponse,
): OverviewResponseDto {
  return {
    ticketsCreated: response.ticketsCreated,
    ticketsResolved: response.ticketsResolved,
    ticketsEscalated: response.ticketsEscalated,
    openTickets: response.openTickets,
    deflection: toRateResponseDto(response.deflection),
    csat: toRateResponseDto(response.csat),
    humanFirstResponseSeconds: toMeanResponseDto(
      response.humanFirstResponseSeconds,
    ),
    aiFirstResponseSeconds: toMeanResponseDto(response.aiFirstResponseSeconds),
    resolutionSeconds: toMeanResponseDto(response.resolutionSeconds),
    openTicketMedianAgeSeconds: response.openTicketMedianAgeSeconds ?? null,
    computedAt: fromProtoTimestamp(response.computedAt) ?? null,
    dataThrough: response.dataThrough ?? null,
  };
}

/** Converts a `DeflectionResponse` off the wire into its REST DTO. */
export function toDeflectionResponseDto(
  response: DeflectionResponse,
): DeflectionResponseDto {
  return {
    points: response.points.map((point) => ({
      day: point.day,
      deflection: toRateResponseDto(point.deflection),
      chatConversations: point.chatConversations,
      chatResolvedWithoutEscalation: point.chatResolvedWithoutEscalation,
    })),
    total: toRateResponseDto(response.total),
    dataThrough: response.dataThrough ?? null,
  };
}

/** Converts a `ResponseTimesResponse` off the wire into its REST DTO. */
export function toResponseTimesResponseDto(
  response: ResponseTimesResponse,
): ResponseTimesResponseDto {
  return {
    points: response.points.map((point) => ({
      day: point.day,
      humanFirstResponseSeconds: toMeanResponseDto(
        point.humanFirstResponseSeconds,
      ),
      aiFirstResponseSeconds: toMeanResponseDto(point.aiFirstResponseSeconds),
      resolutionSeconds: toMeanResponseDto(point.resolutionSeconds),
    })),
    humanTotal: toMeanResponseDto(response.humanTotal),
    aiTotal: toMeanResponseDto(response.aiTotal),
    resolutionTotal: toMeanResponseDto(response.resolutionTotal),
    dataThrough: response.dataThrough ?? null,
  };
}

/** Converts a `VolumeResponse` off the wire into its REST DTO. */
export function toVolumeResponseDto(
  response: VolumeResponse,
): VolumeResponseDto {
  return {
    points: response.points,
    byStatus: response.byStatus,
    byPriority: response.byPriority,
    bySource: response.bySource,
    dataThrough: response.dataThrough ?? null,
  };
}

/** Converts a `SatisfactionResponse` off the wire into its REST DTO. */
export function toSatisfactionResponseDto(
  response: SatisfactionResponse,
): SatisfactionResponseDto {
  return {
    points: response.points.map((point) => ({
      day: point.day,
      csat: toRateResponseDto(point.csat),
      citationAccuracy: toRateResponseDto(point.citationAccuracy),
    })),
    csatTotal: toRateResponseDto(response.csatTotal),
    citationAccuracyTotal: toRateResponseDto(response.citationAccuracyTotal),
    dataThrough: response.dataThrough ?? null,
  };
}

/** Converts a `AiUsageResponse` off the wire into its REST DTO. */
export function toAiUsageResponseDto(
  response: AiUsageResponse,
): AiUsageResponseDto {
  return {
    points: response.points.map((point) => ({
      day: point.day,
      generations: point.generations,
      costMicros: point.costMicros,
    })),
    byPurpose: response.byPurpose.map(toAiUsageSliceResponseDto),
    byModel: response.byModel.map(toAiUsageSliceResponseDto),
    totalCostMicros: response.totalCostMicros,
    totalGenerations: response.totalGenerations,
    monthlyBudgetMicros: response.monthlyBudgetMicros,
    aiModelTier: fromProtoAiModelTier(response.aiModelTier),
    draftAcceptance: toRateResponseDto(response.draftAcceptance),
    emptyRetrievalRate: toRateResponseDto(response.emptyRetrievalRate),
    computedAt: fromProtoTimestamp(response.computedAt) ?? null,
    dataThrough: response.dataThrough ?? null,
  };
}
