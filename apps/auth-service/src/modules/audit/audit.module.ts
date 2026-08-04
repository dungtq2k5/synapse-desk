import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AuditPublisher } from './audit-publisher.service';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';

/**
 * Registers its own NATS client rather than importing NotificationsModule.
 *
 * The two are unrelated concerns that merely share a transport, and coupling
 * them would mean a module that only needs to write audit rows drags email
 * publishing in with it. `ClientsModule.registerAsync` yields a distinct proxy
 * per registration, so both connections are independent.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NATS_CLIENT,
        // The SAME factory ticket-service uses, for its client and its
        // consumer alike. Both ends must agree on the wire format, and one
        // definition is how that stays true — this was an inline literal that
        // happened to match.
        useFactory: (configService: ConfigService) =>
          createNatsTransport(configService),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [AuditPublisher],
  exports: [AuditPublisher],
})
export class AuditModule {}
