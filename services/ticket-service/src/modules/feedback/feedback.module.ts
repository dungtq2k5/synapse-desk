import { Module } from '@nestjs/common';
import { TicketAccessModule } from '../ticket-access/ticket-access.module';
import { FeedbackService } from './feedback.service';
import { FeedbackGrpcController } from './feedback-grpc.controller';

@Module({
  imports: [TicketAccessModule],
  controllers: [FeedbackGrpcController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
