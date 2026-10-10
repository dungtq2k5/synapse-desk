import { MAX_DRAFT_INSTRUCTION_LENGTH } from '../../../../common/config/dto.config';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { trimIfString } from '@synapsedesk/common';

export class GenerateDraftDto {
  /**
   * An optional steer from the agent — "shorter", "offer the refund".
   *
   * Absent means "draft from the thread alone", which is the ordinary case.
   * Bounded because this is user text that reaches a model prompt: an unbounded
   * field here is an unbounded token bill, quite apart from what someone could
   * try to write into it.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_DRAFT_INSTRUCTION_LENGTH)
  @Transform(trimIfString)
  readonly instruction?: string;
}
