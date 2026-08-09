import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/configs/env.validation';
import { FirebaseStorageModule } from './modules/firebase/firebase-storage.module';
import { StorageModule } from './modules/storage/storage.module';
import { DeleteConsumerModule } from './modules/delete-consumer/delete-consumer.module';
import { OpsModule } from './modules/ops/ops.module';

/**
 * No PrismaModule. `storage-service` has no database at all — its only state is
 * a few-minutes-lived PendingUpload in Redis, whose TTL is its own cleanup.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
    FirebaseStorageModule,
    StorageModule,
    DeleteConsumerModule,
    OpsModule,
  ],
})
export class AppModule {}
