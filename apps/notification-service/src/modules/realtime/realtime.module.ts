import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';
import { NotificationRealtimePublisher } from './notification-realtime.publisher';

/**
 * notification-service's first NATS *client* — it has only ever been a server.
 *
 * The same transport factory the consumer side uses: the options are identical
 * regardless of direction, and a second registration would open a second
 * connection to the same broker for one process.
 */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NATS_CLIENT,
        useFactory: (configService: ConfigService) =>
          createNatsTransport(configService),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [NotificationRealtimePublisher],
  exports: [NotificationRealtimePublisher, ClientsModule],
})
export class NotificationRealtimeModule {}
