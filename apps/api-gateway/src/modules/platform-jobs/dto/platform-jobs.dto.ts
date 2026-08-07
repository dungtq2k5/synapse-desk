import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** One job's heartbeat, as the platform surface reports it. */
export class JobRunStatusDto {
  /** Which service owns the schedule — the two have separate databases. */
  service!: string;
  jobName!: string;
  lastStartedAt!: string | null;
  lastSucceededAt!: string | null;
  lastDurationMs!: number | null;
  lastError!: string | null;
  consecutiveFailures!: number;
  /**
   * **`never-ran` | `stale` | `failing` | `healthy`.**
   *
   * Computed here rather than stored, because the judgement needs the list of
   * jobs this build EXPECTS — a job that has never run has no row, and a reader
   * that only looks at the rows it finds reports nothing wrong. That is exactly
   * how seven uncalled jobs stayed invisible.
   */
  health!: string;
}

export class JobHealthResponseDto {
  items!: JobRunStatusDto[];
  /**
   * True when ANY expected job is unhealthy — the single field a monitor can
   * alert on without knowing the job list.
   */
  degraded!: boolean;
  /** Which legs could not be reached, so a partial answer is legible as one. */
  unavailable!: string[];
}

/**
 * A BACKFILL — 20-doc §5.
 *
 * Ranged and mandatory-reason. The range is what keeps it safe to expose: the
 * underlying jobs are idempotent over an explicit window (19-doc §2.2 test 1),
 * which is the property that makes re-running a correction possible at all.
 */
export class BackfillJobDto {
  @IsISO8601({ strict: true }, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @IsISO8601({ strict: true }, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  /**
   * **Mandatory.** A backfill rewrites numbers somebody may already have acted
   * on, and "why" is the only part of that a reader cannot reconstruct
   * afterwards from the rows themselves.
   */
  @IsString()
  @IsNotEmpty({ message: 'a backfill must say why' })
  @MaxLength(500)
  reason!: string;
}

/** What a manual run or backfill produced. */
export class JobRunResultDto {
  service!: string;
  jobName!: string;
  tenants!: number;
  rows!: number;
}
