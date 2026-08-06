import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  AUTH_GRPC_CLIENT,
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATHS,
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
} from '@synapsedesk/grpc-proto';
import { AuthReferenceService } from './auth-reference.service';

/**
 * notification-service's first gRPC dependency.
 *
 * It had none until in-app notifications landed, because email and SMS carry
 * their recipient in the command. An audience addressed by PERMISSION is the
 * first payload that names a question only auth-service can answer.
 */
@Module({
  imports: [
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
  providers: [AuthReferenceService],
  exports: [AuthReferenceService],
})
export class AuthClientModule {}
