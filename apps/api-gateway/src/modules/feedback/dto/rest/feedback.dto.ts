import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  FEEDBACK_RATINGS,
  FeedbackRating,
  MAX_MESSAGE_CONTENT_LENGTH,
  trimIfString,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';

export class SubmitFeedbackDto {
  /** A thumb: `1` for up, `-1` for down. */
  // `@IsIn`, not `@Min(-1) @Max(1)`: a range would also admit 0, and 0 is the
  // proto zero value the LIST request reads as "no filter".
  //
  // `@ApiProperty()` is not decoration here: `FeedbackRating` is the numeric
  // literal union `1 | -1`, which the Swagger plugin cannot map — so it dropped
  // the property from the schema entirely. A REQUIRED field absent from the
  // published contract is worse than an undocumented one: a generated client
  // does not send it, and every call 400s.
  //
  // The description is repeated here because an explicit `@ApiProperty()`
  // REPLACES the introspected comment rather than merging with it — without it
  // the property returns to the spec with no description at all.
  @ApiProperty({
    type: Number,
    enum: FEEDBACK_RATINGS,
    description: 'A thumb: `1` for up, `-1` for down.',
  })
  @Type(() => Number)
  @IsInt()
  @IsIn(FEEDBACK_RATINGS)
  readonly rating!: FeedbackRating;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_CONTENT_LENGTH)
  @Transform(trimIfString)
  readonly feedbackText?: string;

  /**
   * Whether the citations the model gave were accurate.
   *
   * Tri-state on purpose — absent means "not assessed", which is different from
   * "assessed and wrong". Collapsing the two would make every un-assessed reply
   * look like a citation failure in the quality report.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly citationAccurate?: boolean;
}

export class ListFeedbackQueryDto extends SearchPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(FEEDBACK_RATINGS)
  readonly rating?: FeedbackRating;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly citationAccurate?: boolean;

  @IsOptional()
  @Type(() => Date)
  readonly from?: Date;

  @IsOptional()
  @Type(() => Date)
  readonly to?: Date;
}
