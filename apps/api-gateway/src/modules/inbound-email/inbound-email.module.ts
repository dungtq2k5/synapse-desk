import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationGrpcModule } from '../../common/grpc/notification-grpc.module';
import { InboundEmailPublisher } from './inbound-email.publisher';
import { InboundEmailController } from './inbound-email.controller';
import { InboundEmailService } from './inbound-email.service';
import { InboundSignatureGuard } from '../../common/guards/inbound-signature.guard';

/**
 * Inbound email — the gateway is the adapter, and this module is all of it.
 *
 * Everything email-shaped lives here, and everything ticket- or
 * identity-shaped is an RPC to the service that owns it. ticket-service stays
 * ignorant of email.
 */
@Module({
  // `AuthModule` for the auth channel; the ticket channel is global. Both are
  // existing connections — email adds no new peer, only new calls.
  imports: [
    AuthModule,
    // The `In-Reply-To` fallback's owner.
    NotificationGrpcModule,
    // **The gateway's first NATS publisher.** It has consumed events since
    // And never emitted one, so this is a new client rather than a
    // channel that already existed. The transport comes from the SAME factory
    // `main.ts` uses for the consumer side — both ends must agree on the
    // serializer, and one factory is how that stays true.
    ClientsModule.registerAsync([
      {
        name: NATS_CLIENT,
        useFactory: (configService: ConfigService) =>
          createNatsTransport(configService),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [InboundEmailController],
  providers: [
    InboundEmailService,
    InboundEmailPublisher,
    InboundSignatureGuard,
  ],
})
export class InboundEmailModule {}
