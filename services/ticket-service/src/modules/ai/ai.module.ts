import { Module } from '@nestjs/common';
import { TicketAccessModule } from '../ticket-access/ticket-access.module';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { AiClientModule } from '../ai-client/ai-client.module';
import { AiService } from './ai.service';
import { AiAttachmentsModule } from '../ai-attachments/ai-attachments.module';
import { AiGrpcController } from './ai-grpc.controller';

/**
 * Depends on `TicketAccessModule`, NOT on `TicketsModule`.
 *
 * That is the whole point of the extraction: `TicketsModule` imports THIS
 * module so escalation can trigger a summary, so a dependency back the other
 * way would be a cycle.
 */
@Module({
  // `AuthClientModule` for the classification candidates: rag-service cannot
  // see postgres_auth, so the department list travels WITH the request.
  // `AiAttachmentsModule`, NOT `MessagesModule` — same reasoning as the line
  // above, one module further out. Importing `MessagesModule` would reach
  // `TicketsModule` and close the cycle this module was extracted to avoid.
  imports: [
    TicketAccessModule,
    AiClientModule,
    AuthClientModule,
    AiAttachmentsModule,
  ],
  controllers: [AiGrpcController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
