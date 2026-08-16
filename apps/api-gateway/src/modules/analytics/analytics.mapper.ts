/** Wire <-> REST conversions for the analytics surface. */
import {
  AnalyticsExportKind as ProtoAnalyticsExportKind,
  AnalyticsExportStatus as ProtoAnalyticsExportStatus,
  AnalyticsRangeRequest,
  fromProtoAnalyticsExportKind,
  fromProtoAnalyticsExportStatus,
  fromProtoTimestamp,
  type ProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { AnalyticsRangeQueryDto } from './dto/rest/analytics.dto';
import {
  AiUsageSliceDto,
  AnalyticsExportDto,
  MeanDto,
  RateDto,
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
export function toRateDto(value?: {
  rate?: number;
  numerator: number;
  denominator: number;
}): RateDto {
  return {
    rate: value?.rate ?? null,
    numerator: value?.numerator ?? 0,
    denominator: value?.denominator ?? 0,
  };
}

export function toMeanDto(value?: { mean?: number; count: number }): MeanDto {
  return { mean: value?.mean ?? null, count: value?.count ?? 0 };
}

export function toAiUsageSliceDto(slice: {
  purpose: string;
  modelName: string;
  generations: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMs?: { mean?: number; count: number };
  failureRate?: { rate?: number; numerator: number; denominator: number };
}): AiUsageSliceDto {
  return {
    purpose: slice.purpose,
    modelName: slice.modelName,
    generations: slice.generations,
    promptTokens: slice.promptTokens,
    completionTokens: slice.completionTokens,
    costMicros: slice.costMicros,
    latencyMs: toMeanDto(slice.latencyMs),
    failureRate: toRateDto(slice.failureRate),
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
export function toAnalyticsExportDto(response: {
  id: string;
  status: ProtoAnalyticsExportStatus;
  kind: ProtoAnalyticsExportKind;
  rowCount?: number;
  rollupComputedAt?: ProtoTimestamp;
  downloadUrl?: string;
  error?: string;
  createdAt?: ProtoTimestamp;
  completedAt?: ProtoTimestamp;
}): AnalyticsExportDto {
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
