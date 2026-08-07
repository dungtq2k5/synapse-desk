import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  NOTIFICATION_GRPC_CLIENT,
  NOTIFICATION_PACKAGE_NAME,
  NOTIFICATION_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';

/**
 * The gateway's single connection to notification-service — 18-doc §1.1.
 *
 * New because that service had no gRPC server until Domain E's feed existed: it
 * consumed NATS events and wrote rows nobody could read back. `@Global` like
 * the others, so one channel is shared rather than one per feature module.
 */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NOTIFICATION_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: NOTIFICATION_PACKAGE_NAME,
            protoPath: NOTIFICATION_PROTO_PATHS,
            url: configService.getOrThrow<string>('NOTIFICATION_SERVICE_URL'),
            ...GRPC_CHANNEL_OPTIONS,
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class NotificationGrpcModule {}
