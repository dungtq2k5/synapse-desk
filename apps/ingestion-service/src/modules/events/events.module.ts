import { Global, Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';
import { DocumentEventPublisher } from './document-event.publisher';

/**
 * `@Global`, and `ClientsModule` is re-exported so `NATS_CLIENT` itself is
 * injectable rather than only the publisher wrapping it — the storage client
 * needs the raw proxy for `storage.object.superseded`, and a second
 * registration would open a second connection to the same broker.
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
  providers: [DocumentEventPublisher],
  exports: [DocumentEventPublisher, ClientsModule],
})
export class EventsModule {}
