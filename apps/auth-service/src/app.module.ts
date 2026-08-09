import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { envValidationSchema } from './common/configs/env.validation';
import { UsersModule } from './modules/users/users.module';
import { OtpModule } from './modules/otp/otp.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlatformModule } from './modules/platform/platform.module';
import { BillingModule } from './modules/billing/billing.module';
import { OpsModule } from './modules/ops/ops.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available without re-importing
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env vars not declared in the schema
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    OtpModule,
    InvitationsModule,
    DepartmentsModule,
    SessionsModule,
    SchedulerModule,
    OrganizationsModule,
    PlatformModule,
    BillingModule,
    OpsModule,
  ],
})
export class AppModule {}
