import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/configs/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthClientModule } from './modules/auth-client/auth-client.module';
import { NotificationsController } from './modules/notifications.controller';
import { InAppNotificationService } from './modules/in-app/in-app-notification.service';
import { EmailService } from './modules/email/email.service';
import { SmsService } from './modules/sms/sms.service';

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
  ],
  controllers: [NotificationsController],
  providers: [EmailService, SmsService, InAppNotificationService],
})
export class AppModule {}
