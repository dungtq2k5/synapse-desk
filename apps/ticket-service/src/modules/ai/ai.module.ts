import { Module } from '@nestjs/common';
import { TicketAccessModule } from '../ticket-access/ticket-access.module';
import { AiClientModule } from '../ai-client/ai-client.module';
import { AiService } from './ai.service';
import { AiGrpcController } from './ai-grpc.controller';

/**
 * Depends on `TicketAccessModule`, NOT on `TicketsModule`.
 *
 * That is the whole point of the extraction: `TicketsModule` imports THIS
 * module so escalation can trigger a summary, so a dependency back the other
 * way would be a cycle.
 */
@Module({
  imports: [TicketAccessModule, AiClientModule],
  controllers: [AiGrpcController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
