import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuditModule } from '../audit/audit.module';
import { StripeService } from './stripe.service';
import { BillingService } from './billing.service';
import { BillingEventPublisher } from './billing-event.publisher';
import { EntitlementWriterService } from './entitlement-writer.service';
import { PlanCatalogService } from './plan-catalog.service';
import { PlanAdminService } from './plan-admin.service';
import { DunningService } from './dunning.service';
import { PlanChangeService } from './plan-change.service';
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
    // **For `seatsInUse`, and only for it.** `PlanAdminService` re-implemented
    // that count rather than importing it — the duplicate existed because this
    // module did not import the one that owns it, not because a second
    // definition was wanted. `OrganizationsModule` pulls Prisma, LimitAlerts,
    // Audit, Notifications and Sessions, none of which reach back here, so this
    // closes no cycle.
    OrganizationsModule,
    // Plan CRUD and plan application publish AUDIT events, not billing ones:
    // `billing_events` is a Stripe webhook ledger and a Super Admin edit has no
    // `evt_…` id to key it by.
    AuditModule,
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
    PlanCatalogService,
    PlanAdminService,
    DunningService,
    PlanChangeService,
  ],
  exports: [
    BillingService,
    EntitlementWriterService,
    StripeService,
    PlanCatalogService,
    PlanAdminService,
  ],
})
export class BillingModule {}
