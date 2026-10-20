import { ApiProperty } from '@nestjs/swagger';
import { FEEDBACK_RATINGS, FeedbackRating } from '@synapsedesk/contracts';

export class FeedbackResponseDto {
  id!: string;
  ticketMessageId!: string;
  userId!: string;
  organizationId!: string;

  // `FeedbackRating` is the numeric literal union `1 | -1`, which the Swagger
  // plugin cannot map — see `SubmitFeedbackDto.rating`'s identical note. Without
  // this the property is silently absent from the published contract, so a
  // generated client has no field to put the value in at all.
  @ApiProperty({ type: Number, enum: FEEDBACK_RATINGS })
  rating!: FeedbackRating;
  feedbackText!: string | null;
  /** null means "not assessed", NOT "assessed and wrong". */
  citationAccurate!: boolean | null;
  createdAt!: Date;
  updatedAt!: Date;
  /** The rated answer's ticket, to open it from. Null only when the message is gone. */
  ticketId!: string | null;
  /** That ticket's number, as "Ticket #{n}" shows it. */
  ticketNumber!: number | null;
}
