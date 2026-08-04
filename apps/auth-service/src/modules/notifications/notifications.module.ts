import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { NotificationPublisher } from './notification-publisher.service';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';

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
  providers: [NotificationPublisher],
  exports: [NotificationPublisher],
})
export class NotificationsModule {}
