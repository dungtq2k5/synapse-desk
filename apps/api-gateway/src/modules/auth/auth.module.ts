import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthServiceGrpcClient } from './auth-service-grpc.client';
import { JwtCookieService } from './jwt-cookie.service';
import { TwoFactorAuthController } from './two-factor-auth.controller';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { TwoFactorAuthGrpcClient } from './two-factor-auth-grpc.client';
import {
  AUTH_GRPC_CLIENT,
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATHS,
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
} from '@synapsedesk/grpc-proto';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { readFileSync } from 'node:fs';
import { JwtStrategy } from '../../strategies/jwt.strategy';
import { Jwt2faStrategy } from '../../strategies/jwt-2fa.strategy';
import { Jwt2faGuard } from '../../common/guards/jwt-2fa.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GuestGuard } from '../../common/guards/guest.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // GuestGuard verifies the access token locally, so the gateway needs the
    // PUBLIC half of the RS256 pair. It never signs anything — only
    // auth-service holds the private key.
    JwtModule.registerAsync({
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        publicKey: readFileSync(
          config.getOrThrow<string>('JWT_ACCESS_PUBLIC_KEY_PATH'),
        ),
        verifyOptions: { algorithms: ['RS256'] },
      }),
      inject: [ConfigService],
    }),
    ClientsModule.registerAsync([
      {
        name: AUTH_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: AUTH_PACKAGE_NAME,
            protoPath: AUTH_PROTO_PATHS,
            url: configService.getOrThrow<string>('AUTH_SERVICE_URL'),
            ...GRPC_CHANNEL_OPTIONS,
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [AuthController, TwoFactorAuthController],
  providers: [
    AuthService,
    AuthServiceGrpcClient,
    TwoFactorAuthService,
    TwoFactorAuthGrpcClient,
    JwtCookieService,
    JwtStrategy,
    Jwt2faStrategy,
    JwtAuthGuard,
    Jwt2faGuard,
    GuestGuard,
  ],
  // ClientsModule is re-exported so sibling modules (OtpModule) can inject the
  // same AUTH_GRPC_CLIENT rather than opening a second connection to one peer.
  exports: [
    AuthService,
    JwtAuthGuard,
    GuestGuard,
    JwtCookieService,
    ClientsModule,
  ],
})
export class AuthModule {}
