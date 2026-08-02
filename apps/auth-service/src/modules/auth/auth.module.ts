import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthGrpcController } from './auth-grpc.controller';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { TwoFactorAuthGrpcController } from './two-factor-auth-grpc.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FirebaseModule } from '../firebase/firebase.module';
import { OtpModule } from '../otp/otp.module';
import { RolesModule } from '../roles/roles.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AuditModule } from '../audit/audit.module';
import { readFileSync } from 'node:fs';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    FirebaseModule,
    OtpModule,
    RolesModule,
    SessionsModule,
    AuditModule,
    // Access-token defaults live here; generate2faToken() overrides them
    // per-call with the 2FA secret and TTL.
    JwtModule.registerAsync({
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        privateKey: readFileSync(
          config.getOrThrow('JWT_ACCESS_PRIVATE_KEY_PATH'),
        ),
        signOptions: {
          algorithm: 'RS256',
          expiresIn: config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
        } as JwtSignOptions,
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, TwoFactorAuthService],
  controllers: [AuthGrpcController, TwoFactorAuthGrpcController],
  exports: [AuthService],
})
export class AuthModule {}
