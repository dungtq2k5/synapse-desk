import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { envValidationSchema } from './common/configs/env.validation';
import { UsersModule } from './modules/users/users.module';
import { OtpModule } from './modules/otp/otp.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available without re-importing
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env vars not declared in the schema
      },
    }),
    // Drives InvitationsExpiryJob. Registered once, globally.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    OtpModule,
    InvitationsModule,
  ],
})
export class AppModule {}
