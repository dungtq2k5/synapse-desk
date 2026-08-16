import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeService } from './stripe.service';
import { BillingService } from './billing.service';
import { BillingEventPublisher } from './billing-event.publisher';
import { EntitlementWriterService } from './entitlement-writer.service';
import { BillingGrpcController } from './billing-grpc.controller';

/**
 * Billing lives in `auth-service` because it owns `organizations`, and
 * entitlements are columns on that row. A separate
 * billing service would need write access to another service's table, which is
 * exactly what service-per-database exists to prevent.
 */
@Module({
  imports: [
    PrismaModule,
    // Its own NATS registration, like `AuditModule`'s and for the same reason:
    // `ClientsModule.registerAsync` yields a distinct proxy per registration,
    // so a module that only needs to announce an entitlement change does not
    // drag audit or notification publishing in with it.
    ClientsModule.registerAsync([
      {
        name: NATS_CLIENT,
        useFactory: (configService: ConfigService) =>
          createNatsTransport(configService),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [BillingGrpcController],
  providers: [
    StripeService,
    BillingService,
    BillingEventPublisher,
    EntitlementWriterService,
  ],
  exports: [BillingService, EntitlementWriterService, StripeService],
})
export class BillingModule {}
