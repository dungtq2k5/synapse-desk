import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeedbackGrpcClient } from './feedback-grpc.client';
import {
  FeedbackController,
  MessageFeedbackController,
} from './feedback.controller';

@Module({
  imports: [AuthModule],
  controllers: [MessageFeedbackController, FeedbackController],
  providers: [FeedbackGrpcClient],
  exports: [FeedbackGrpcClient],
})
export class FeedbackModule {}
