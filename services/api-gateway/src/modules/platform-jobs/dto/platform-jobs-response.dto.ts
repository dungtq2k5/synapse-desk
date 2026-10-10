/** What the platform job routes return. */

import { JobHealth, ScheduledJobName } from '@synapsedesk/common';
import { GrpcPeer } from '@synapsedesk/grpc-proto';

/** One job's heartbeat, as the platform surface reports it. */
export class JobRunStatusResponseDto {
  /** Which service owns the schedule — the two have separate databases. */
  service!: GrpcPeer;
  // `string`, not `ScheduledJobName`: the step rows below carry names that are
  // deliberately OUTSIDE that set — a step is not a scheduled job.
  jobName!: string;
  lastStartedAt!: string | null;
  lastSucceededAt!: string | null;
  lastDurationMs!: number | null;
  lastError!: string | null;
  consecutiveFailures!: number;
  /**
   * How this row is doing — see {@link JobHealth} for the five values.
   *
   * Computed here rather than stored, because the judgement needs the list of
   * jobs this build EXPECTS: a job that has never run has no row, and a reader
   * that only looks at the rows it finds reports nothing wrong.
   */
  health!: JobHealth;
}

export class JobHealthResponseDto {
  items!: JobRunStatusResponseDto[];
  /**
   * True when ANY expected job is unhealthy — the single field a monitor can
   * alert on without knowing the job list.
   */
  degraded!: boolean;
  /** Which legs could not be reached, so a partial answer is legible as one. */
  unavailable!: string[];
}

/** What a manual run or backfill produced. */
export class JobRunResultResponseDto {
  service!: GrpcPeer;
  jobName!: ScheduledJobName;
  tenants!: number;
  rows!: number;
}
