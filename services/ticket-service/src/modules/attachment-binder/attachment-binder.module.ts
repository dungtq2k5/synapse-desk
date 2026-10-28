import { Module } from '@nestjs/common';
import { AiClientModule } from '../ai-client/ai-client.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { AttachmentBinder } from './attachment-binder';

@Module({
  imports: [StorageClientModule, AiClientModule],
  providers: [AttachmentBinder],
  exports: [AttachmentBinder],
})
export class AttachmentBinderModule {}
