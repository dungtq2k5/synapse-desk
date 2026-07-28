import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthServiceGrpcClient } from './auth-service-grpc.client';
import { JwtCookieService } from './jwt-cookie.service';
import {
  AUTH_GRPC_CLIENT,
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATH,
  GRPC_LOADER_OPTIONS,
} from '@synapsedesk/grpc-proto';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: AUTH_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: AUTH_PACKAGE_NAME,
            protoPath: AUTH_PROTO_PATH,
            url: configService.getOrThrow<string>('AUTH_SERVICE_URL'),
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthServiceGrpcClient, JwtCookieService],
})
export class AuthModule {}
