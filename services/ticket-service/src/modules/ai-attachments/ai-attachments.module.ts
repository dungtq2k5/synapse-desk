import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { AiAttachmentService } from './ai-attachment.service';

/**
 * Its own module, and the cycle is why.
 *
 * All three AI call sites need the same filter-and-fetch, and two of them live
 * in ticket-service. The obvious home was `MessagesModule`, which
 * owns `message_attachments` — but `AiModule` would then import it, and
 * `MessagesModule` imports `TicketsModule`, which imports `AiModule` so
 * escalation can trigger a summary. That is a cycle, and `ai.module.ts` already
 * carries a docblock explaining that it exists to avoid exactly this one.
 *
 * So the shared behaviour moves to a third module that depends on neither —
 * Prisma for the rows, storage for the bytes, and nothing else. Both callers
 * import this; nothing imports them back.
 */
@Module({
  imports: [PrismaModule, StorageClientModule],
  providers: [AiAttachmentService],
  exports: [AiAttachmentService],
})
export class AiAttachmentsModule {}
