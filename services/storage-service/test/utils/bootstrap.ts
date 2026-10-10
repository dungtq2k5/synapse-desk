import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { FirebaseStorageService } from '../../src/modules/firebase/firebase-storage.service';
import { STORAGE_REDIS } from '../../src/modules/storage/pending-upload.store';

export type E2eFixture = {
  moduleRef: TestingModule;
  firebase: FirebaseStorageService;
  redis: Redis;
  /** Empties the bucket and the Redis index. Call in `beforeEach`. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Boots the real storage-service wiring against the EMULATOR and a real Redis.
 *
 * Same shape as ticket-service's, minus Prisma — this service has no database.
 * What "real infra, no mocks" means here is the emulator plus a
 * test-index Redis, and both are torn down between tests.
 */
export async function bootstrapE2eTest(): Promise<E2eFixture> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const firebase = moduleRef.get(FirebaseStorageService);
  const redis = moduleRef.get<Redis>(STORAGE_REDIS);

  // `compile()` alone does not fire `onModuleInit`, so the Firebase app has not
  // been initialized yet and `firebase.bucket` would be undefined.
  await moduleRef.init();

  const reset = async (): Promise<void> => {
    // FLUSHDB, not FLUSHALL. The index is pinned to REDIS_DB in .env.test
    // precisely so this cannot reach a developer's dev data sitting in db 0 of
    // the same container.
    await redis.flushdb();

    // Emptying the bucket keeps one test's objects out of another's read-URL
    // batches — and a leftover object at a path a later test presigns would
    // make a "the client never uploaded" assertion pass for the wrong reason.
    const [files] = await firebase.bucket.getFiles();
    await Promise.all(
      files.map((file) => file.delete({ ignoreNotFound: true })),
    );
  };

  const close = async (): Promise<void> => {
    await reset();
    // `close()` fires onModuleDestroy, which is where PendingUploadStore
    // disconnects Redis — no explicit disconnect needed here, and adding one
    // would hide a missing hook rather than surface it.
    await moduleRef.close();
  };

  return { moduleRef, firebase, redis, reset, close };
}

/**
 * PUTs bytes to a signed upload URL, the way a browser would.
 *
 * The whole point of presign/confirm is that the bytes bypass every application
 * server, so a test that wrote through the Admin SDK instead would skip the one
 * step this design exists to enable — and would never notice a signature that
 * did not actually work.
 */
export async function uploadTo(
  uploadUrl: string,
  body: string,
  contentType: string,
): Promise<number> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });

  return response.status;
}
