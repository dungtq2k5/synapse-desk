import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingGrpcClient } from './billing-grpc.client';
import { BillingController } from './billing.controller';
import { WebhooksController } from './webhooks.controller';

/**
 * Two controllers, one client — and they are deliberately separate classes.
 *
 * `/billing/*` is authenticated and permissioned; `/webhooks/stripe` is neither
 * (14-doc §3.3). Putting them on one controller would mean the webhook
 * inheriting a class-level `@UseGuards`, and the bypass that route depends on
 * would become an easy thing to reintroduce by accident.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController, WebhooksController],
  providers: [BillingGrpcClient],
  exports: [BillingGrpcClient],
})
export class BillingModule {}
