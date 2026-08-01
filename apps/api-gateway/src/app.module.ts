import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/config/env.validation';
import { UsersModule } from './modules/users/users.module';
import { OtpModule } from './modules/otp/otp.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available globally
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env variables that are not defined in the validation schema
      },
    }),
    AuthModule,
    UsersModule,
    OtpModule,
    InvitationsModule,
    HealthModule,
  ],
})
export class AppModule {}
