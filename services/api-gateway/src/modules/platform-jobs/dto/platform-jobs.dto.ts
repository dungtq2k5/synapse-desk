import { ApiProperty } from '@nestjs/swagger';
import { MAX_ADMIN_REASON_LENGTH } from '../../../common/config/dto.config';
import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * A BACKFILL.
 *
 * Ranged and mandatory-reason. The range is what keeps it safe to expose: the
 * underlying jobs are idempotent over an explicit window,
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
  @MaxLength(MAX_ADMIN_REASON_LENGTH)
  // `@IsNotEmpty` has no OpenAPI spelling of its own, so without this the
  // document says `{"type": "string"}` and a generated client accepts `""`
  // — a 400 here and a pass elsewhere. `minLength: 1` is the document's way
  // to say it, and it generates `@Size(min = 1)`, which (unlike `@NotBlank`)
  // accepts `"   "` exactly as `@IsNotEmpty` does.
  @ApiProperty({ minLength: 1 })
  reason!: string;
}
