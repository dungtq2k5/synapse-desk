import { ApiProperty } from '@nestjs/swagger';
import { FEEDBACK_RATINGS, FeedbackRating } from '@synapsedesk/common';

export class FeedbackResponseDto {
  id!: string;
  ticketMessageId!: string;
  userId!: string;
  organizationId!: string;

  // `FeedbackRating` is the numeric literal union `1 | -1`, which the Swagger
  // plugin cannot map — see `SubmitFeedbackDto.rating`'s identical note. Without
  // this the property is silently absent from the published contract, so a
  // generated client (Java's included) has no field to put the value in at all.
  @ApiProperty({ type: Number, enum: FEEDBACK_RATINGS })
  rating!: FeedbackRating;
  feedbackText!: string | null;
  /** null means "not assessed", NOT "assessed and wrong". */
  citationAccurate!: boolean | null;
  createdAt!: Date;
  updatedAt!: Date;
}
