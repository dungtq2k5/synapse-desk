import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AuditPublisher } from './audit-publisher.service';
import { NATS_CLIENT } from '../../common/configs/app.config';

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
  providers: [AuditPublisher],
  exports: [AuditPublisher],
})
export class AuditModule {}
