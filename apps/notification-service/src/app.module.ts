import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/configs/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthClientModule } from './modules/auth-client/auth-client.module';
import { NotificationsController } from './modules/notifications.controller';
import { InAppNotificationService } from './modules/in-app/in-app-notification.service';
import { TicketNotificationConsumer } from './modules/in-app/ticket-notification.consumer';
import { EmailService } from './modules/email/email.service';
import { SmsService } from './modules/sms/sms.service';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { NotificationRealtimeModule } from './modules/realtime/realtime.module';
import { FeedModule } from './modules/feed/feed.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
    // Domain E gained a database when in-app notifications landed — 16-doc §1.
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
    // The read half — 18-doc §2. Domain E was NATS-only until this existed:
    // it consumed events and wrote rows nobody could read back.
    FeedModule,
  ],
  controllers: [
    NotificationsController,
    // `ticket.*` → notifications (18-doc §3). A separate controller rather than
    // more handlers on the one above, because the two answer to different
    // producers: one is Domain E's own command subject, this one subscribes to
    // another domain's events and translates them.
    TicketNotificationConsumer,
  ],
  providers: [EmailService, SmsService, InAppNotificationService],
})
export class AppModule {}
