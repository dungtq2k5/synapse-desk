import { FeedbackRating } from '@synapsedesk/common';

export class FeedbackResponseDto {
  id!: string;
  ticketMessageId!: string;
  userId!: string;
  organizationId!: string;
  rating!: FeedbackRating;
  feedbackText!: string | null;
  /** null means "not assessed", NOT "assessed and wrong". */
  citationAccurate!: boolean | null;
  createdAt!: Date;
  updatedAt!: Date;
}
