import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { NotificationPublisher } from './notification-publisher.service';
import { NATS_CLIENT } from '../../common/configs/app.config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NATS_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.NATS,
          options: {
            servers: [configService.getOrThrow<string>('NATS_URL')],
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [NotificationPublisher],
  exports: [NotificationPublisher],
})
export class NotificationsModule {}
