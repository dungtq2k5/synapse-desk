import { Global, Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';
import { TicketEventPublisher } from './ticket-event.publisher';

/**
 * `@Global` because nearly every module in this service publishes an event —
 * tickets, assignments and messages all do — and importing this in each of them
 * is ceremony that says nothing. Same judgement as PrismaModule.
 *
 * The transport comes from the SAME factory `main.ts` uses for the consumer
 * side. Both ends must agree on the serializer, and one factory is how that
 * stays true.
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
  providers: [TicketEventPublisher],
  // `ClientsModule` is re-exported so NATS_CLIENT itself is injectable, not just
  // the publisher wrapping it. `StorageReferenceService` needs the raw client
  // to emit `storage.object.superseded`, and registering a SECOND client for
  // that would open a second connection to the same broker for one subject.
  exports: [TicketEventPublisher, ClientsModule],
})
export class EventsModule {}
