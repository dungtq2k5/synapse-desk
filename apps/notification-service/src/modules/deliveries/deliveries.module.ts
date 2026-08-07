import { Global, Module } from '@nestjs/common';
import { DeliveryRecorder } from './delivery-recorder.service';

/** `@Global`: every channel writes here, and there is nothing to configure. */
@Global()
@Module({
  providers: [DeliveryRecorder],
  exports: [DeliveryRecorder],
})
export class DeliveriesModule {}
