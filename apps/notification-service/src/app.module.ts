import { Module } from '@nestjs/common';
import { JetStreamModule } from '@synapsedesk/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/configs/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthClientModule } from './modules/auth-client/auth-client.module';
import { NotificationsController } from './modules/notifications.controller';
import { InAppNotificationService } from './modules/in-app/in-app-notification.service';
import { TicketNotificationConsumer } from './modules/in-app/ticket-notification.consumer';
import { EmailService } from './modules/email/email.service';
import { SmsService } from './modules/sms/sms.service';
import { PushModule } from './modules/push/push.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { NotificationRealtimeModule } from './modules/realtime/realtime.module';
import { FeedModule } from './modules/feed/feed.module';
import { OpsModule } from './modules/ops/ops.module';
import { InboundRejectionConsumer } from './modules/inbound-email/inbound-rejection.consumer';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
    JetStreamModule,
    // Domain E gained a database when in-app notifications landed.
    // Email and SMS carry their recipient in the command and need no storage;
    // an in-app feed is storage by definition.
    PrismaModule,
    AuthClientModule,
    // The three `@Global` modules the write path composes from — a delivery
    // row, a preference decision and a socket emit accompany EVERY
    // notification, so importing them per-feature would be four copies of the
    // same import list.
    DeliveriesModule,
    PreferencesModule,
    NotificationRealtimeModule,
    // The read half. Domain E was NATS-only until this existed:
    // it consumed events and wrote rows nobody could read back.
    FeedModule,
    PushModule,
    OpsModule,
  ],
  controllers: [
    // `ticket.*` → notifications. A separate class rather than more handlers on
    // `NotificationsController`, because the two answer to different
    // producers: one is Domain E's own command subject, this one subscribes to
    // another domain's events and translates them.
    TicketNotificationConsumer,
    // `email.inbound_rejected` → one courtesy reply. Registered
    // here beside the other consumer rather than in its own module, because
    // `EmailService` is an AppModule provider and a module of its own would be
    // a wrapper around one class with nothing else in it.
    InboundRejectionConsumer,
  ],
  providers: [
    // A provider, not a controller: ADR 0041 moved its three subjects to
    // JetStream, which Nest's core-only transport cannot route to. `main.ts`
    // runs a `PullConsumerRunner` per subject and calls it directly.
    NotificationsController,
    EmailService,
    SmsService,
    InAppNotificationService,
  ],
})
export class AppModule {}
