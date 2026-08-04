import { Module } from '@nestjs/common';
import { TicketAccessModule } from '../ticket-access/ticket-access.module';
import { AiModule } from '../ai/ai.module';
import { TicketsService } from './tickets.service';
import { TicketsGrpcController } from './tickets-grpc.controller';

@Module({
  imports: [TicketAccessModule, AiModule],
  controllers: [TicketsGrpcController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
