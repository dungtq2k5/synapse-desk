import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FirebaseStorageModule } from '../firebase/firebase-storage.module';
import { StorageService } from './storage.service';
import { StorageGrpcController } from './storage-grpc.controller';
import { PendingUploadStore, STORAGE_REDIS } from './pending-upload.store';
import { RemoteSourceFetcher } from './remote-source.fetcher';

/**
 * The Redis client is provided HERE rather than globally, and closed on
 * shutdown.
 *
 * Domain A hit the other version of this: a client created without an
 * `onModuleDestroy` kept the process alive after tests finished, which reads as
 * a hung test run rather than a leaked connection. `useFactory` plus the
 * explicit teardown below is what makes `app.close()` actually close.
 */
@Module({
  imports: [FirebaseStorageModule],
  controllers: [StorageGrpcController],
  providers: [
    StorageService,
    PendingUploadStore,
    RemoteSourceFetcher,
    {
      provide: STORAGE_REDIS,
      useFactory: (configService: ConfigService) =>
        new Redis(configService.getOrThrow<string>('REDIS_URL'), {
          // A distinct index in the test environment, so a suite's FLUSHDB
          // cannot take a developer's dev data with it.
          db: configService.get<number>('REDIS_DB') ?? 0,
          lazyConnect: false,
          maxRetriesPerRequest: 2,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [StorageService, PendingUploadStore, STORAGE_REDIS],
})
export class StorageModule {}
