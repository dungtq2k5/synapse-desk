import { Module } from '@nestjs/common';
import { FirebaseStorageService } from './firebase-storage.service';

/**
 * One bucket handle, shared. Two would mean two credential loads and two
 * `initializeApp` calls racing on the same named app.
 */
@Module({
  providers: [FirebaseStorageService],
  exports: [FirebaseStorageService],
})
export class FirebaseStorageModule {}
