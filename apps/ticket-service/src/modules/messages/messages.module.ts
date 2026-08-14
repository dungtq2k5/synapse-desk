import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { AiClientModule } from '../ai-client/ai-client.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { MessagesService } from './messages.service';
import { AiAttachmentsModule } from '../ai-attachments/ai-attachments.module';
import { MessagesGrpcController } from './messages-grpc.controller';

/**
 * `TicketsModule` for the tenant + visibility check every thread read runs
 * first; `AiClientModule` for `invokeAi`'s second, separate write.
 */
@Module({
  imports: [
    TicketsModule,
    AiClientModule,
    StorageClientModule,
    AiAttachmentsModule,
  ],
  controllers: [MessagesGrpcController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
