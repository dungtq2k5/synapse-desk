import { Module } from '@nestjs/common';
import { FirebaseStorageModule } from '../firebase/firebase-storage.module';
import { DeleteConsumer } from './delete.consumer';

@Module({
  imports: [FirebaseStorageModule],
  controllers: [DeleteConsumer],
})
export class DeleteConsumerModule {}
