import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/configs/env.validation';
import { NotificationsController } from './modules/notifications.controller';
import { EmailService } from './modules/email/email.service';
import { SmsService } from './modules/sms/sms.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
  ],
  controllers: [NotificationsController],
  providers: [EmailService, SmsService],
})
export class AppModule {}
