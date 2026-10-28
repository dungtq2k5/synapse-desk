import { Module } from '@nestjs/common';
import { TicketAccessModule } from '../ticket-access/ticket-access.module';
import { AiModule } from '../ai/ai.module';
import { AttachmentBinderModule } from '../attachment-binder/attachment-binder.module';
import { TicketsService } from './tickets.service';
import { TicketsGrpcController } from './tickets-grpc.controller';

@Module({
  imports: [TicketAccessModule, AiModule, AttachmentBinderModule],
  controllers: [TicketsGrpcController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
