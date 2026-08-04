import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  FeedbackResponse,
  FeedbackServiceController,
  FeedbackServiceControllerMethods,
  ListFeedbackRequest,
  ListFeedbackResponse,
  SubmitFeedbackRequest,
  unpackCallerContext,
  WithdrawFeedbackRequest,
  WithdrawFeedbackResponse,
} from '@synapsedesk/grpc-proto';
import { FeedbackService } from './feedback.service';

@Controller()
@FeedbackServiceControllerMethods()
export class FeedbackGrpcController implements FeedbackServiceController {
  constructor(private readonly feedback: FeedbackService) {}

  submitFeedback(
    request: SubmitFeedbackRequest,
    metadata?: Metadata,
  ): Promise<FeedbackResponse> {
    return this.feedback.submitFeedback(request, unpackCallerContext(metadata));
  }

  listFeedback(
    request: ListFeedbackRequest,
    metadata?: Metadata,
  ): Promise<ListFeedbackResponse> {
    return this.feedback.listFeedback(request, unpackCallerContext(metadata));
  }

  withdrawFeedback(
    request: WithdrawFeedbackRequest,
    metadata?: Metadata,
  ): Promise<WithdrawFeedbackResponse> {
    return this.feedback.withdrawFeedback(
      request,
      unpackCallerContext(metadata),
    );
  }
}
