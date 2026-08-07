import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  ANALYTICS_EXPORT_KINDS,
  ANALYTICS_GRANULARITIES,
  ANALYTICS_TOP_N,
} from '@synapsedesk/common';

/**
 * The shared analytics filter — api-endpoints-plan §4.
 *
 * `from`/`to` are DATES rather than timestamps, because the rollups are
 * bucketed by the tenant's local day. Accepting an instant would invite a
 * caller to believe it selects a sub-day window, which does not exist and never
 * will: the whole design trades that resolution away for a dashboard that does
 * not compete with ticket creation.
 */
export class AnalyticsRangeQueryDto {
  @IsISO8601({ strict: true })
  readonly from!: string;

  @IsISO8601({ strict: true })
  readonly to!: string;

  @IsOptional()
  @IsUUID('4')
  readonly departmentId?: string;

  @IsOptional()
  @IsIn(ANALYTICS_GRANULARITIES)
  readonly granularity?: string;
}

/** Knowledge gaps and document lists take a size rather than a page. */
export class AnalyticsTopNQueryDto extends AnalyticsRangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(ANALYTICS_TOP_N.MIN)
  @Max(ANALYTICS_TOP_N.MAX)
  readonly limit?: number = ANALYTICS_TOP_N.DEFAULT;
}

/**
 * The document endpoint takes NO range.
 *
 * The chunk counters it reads are lifetime totals, and a "never retrieved in
 * March" list would flag every document written in April — a finding that says
 * more about the range than about the corpus.
 */
export class DocumentAnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(ANALYTICS_TOP_N.MIN)
  @Max(ANALYTICS_TOP_N.MAX)
  readonly limit?: number = ANALYTICS_TOP_N.DEFAULT;
}

/**
 * The export request — 19-doc §5.
 *
 * A POST rather than the `GET /analytics/export` the endpoint plan names,
 * because it CREATES a job: a GET that writes a row and queues work is one that
 * a browser prefetch, a link preview or a retry can trigger, and each of those
 * would produce a file. The plan's own note says the endpoint "returns a job id,
 * then a download URL", which is a creation whatever the verb says.
 */
export class CreateExportDto {
  @IsIn(ANALYTICS_EXPORT_KINDS)
  readonly kind!: string;

  @IsISO8601({ strict: true })
  readonly from!: string;

  @IsISO8601({ strict: true })
  readonly to!: string;

  @IsOptional()
  @IsUUID('4')
  readonly departmentId?: string;
}
