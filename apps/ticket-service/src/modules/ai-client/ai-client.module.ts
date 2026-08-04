import { Module } from '@nestjs/common';
import { RagClientService } from './rag-client.service';

/**
 * The `rag-service` seam, in its own module so both the message thread
 * (`invokeAi`, §2.5) and the AI Co-Pilot surface (§2.6) share one instance and
 * one availability check.
 */
@Module({
  providers: [RagClientService],
  exports: [RagClientService],
})
export class AiClientModule {}
