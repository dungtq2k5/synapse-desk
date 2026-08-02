import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { getThrottlerConfig } from './common/config/throttler.config';
import { SmartThrottlerGuard } from './common/guards/smart-throttler.guard';
import { OrganizationStatusInterceptor } from './common/interceptors/organization-status.interceptor';
import { OrganizationStatusModule } from './common/services/organization-status.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/config/env.validation';
import { UsersModule } from './modules/users/users.module';
import { OtpModule } from './modules/otp/otp.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { HealthModule } from './modules/health/health.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { RolesModule } from './modules/roles/roles.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available globally
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true, // Ignore env variables that are not defined in the validation schema
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getThrottlerConfig,
    }),

    OrganizationStatusModule,
    AuthModule,

    // ORDER MATTERS for everything mounted under /users.
    //
    // Nest matches routes in REGISTRATION order, and registration order is
    // module import order. `UserAdminController` declares `/users/:id`, which
    // matches `/users/invitations` and `/users/<uuid>/sessions` equally well —
    // so any module owning a LITERAL segment under /users must be imported
    // before UsersModule, or its routes are swallowed and ParseUUIDPipe turns
    // them into a 400 that looks like a client bug.
    //
    // This is not hypothetical: adding `/users/:id` broke `GET
    // /users/invitations` until these two lines were swapped.
    InvitationsModule,
    SessionsModule,
    UsersModule,

    OtpModule,
    DepartmentsModule,
    RolesModule,
    OrganizationsModule,
    PlatformModule,
    HealthModule,
  ],
  providers: [
    // Global, so a route added later is rate-limited by DEFAULT. Registering it
    // per-controller would mean the one someone forgets is the one with no
    // limit — and that is reliably the interesting one.
    { provide: APP_GUARD, useClass: SmartThrottlerGuard },
    // An INTERCEPTOR, not a guard: global guards run before route-level ones,
    // so this would execute before JwtAuthGuard had resolved the caller and
    // would have no tenant to gate on. Interceptors run after every guard.
    { provide: APP_INTERCEPTOR, useClass: OrganizationStatusInterceptor },
  ],
})
export class AppModule {}
