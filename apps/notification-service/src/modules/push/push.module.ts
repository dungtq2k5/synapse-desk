import { Module } from '@nestjs/common';
import { DeviceTokenService } from './device-token.service';
import { FirebaseMessagingService } from './firebase-messaging.service';

/**
 * Push, as its own module because two unrelated places need it.
 *
 * `FeedModule`'s controller registers and forgets devices; the write path's
 * fan-out sends to them. A provider listed in `app.module` would resolve for
 * neither — a controller's dependencies come from its OWN module's context —
 * which is exactly the error that surfaced when they were.
 */
@Module({
  providers: [DeviceTokenService, FirebaseMessagingService],
  exports: [DeviceTokenService, FirebaseMessagingService],
})
export class PushModule {}
