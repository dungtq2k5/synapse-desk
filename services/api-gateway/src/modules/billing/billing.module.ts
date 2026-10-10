import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PlanChangeGuard } from './plan-change.guard';
import { BillingGrpcClient } from './billing-grpc.client';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { WebhooksController } from './webhooks.controller';

/**
 * Two controllers, one client — and they are deliberately separate classes.
 *
 * `/billing/*` is authenticated and permissioned; `/webhooks/stripe` is neither.
 * Putting them on one controller would mean the webhook
 * inheriting a class-level `@UseGuards`, and the bypass that route depends on
 * would become an easy thing to reintroduce by accident.
 */
@Module({
  // `DocumentsModule` for `DocumentsGrpcClient` — the plan-change block reads
  // ingestion's TENANT-SCOPED usage, which is the only surface that cannot be
  // asked about another tenant.
  imports: [AuthModule, DocumentsModule],
  controllers: [BillingController, WebhooksController],
  providers: [BillingGrpcClient, BillingService, PlanChangeGuard],
  exports: [BillingService],
})
export class BillingModule {}
