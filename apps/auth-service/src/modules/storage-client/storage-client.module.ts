import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { createNatsTransport, NATS_CLIENT } from '@synapsedesk/common';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  STORAGE_GRPC_CLIENT,
  STORAGE_PACKAGE_NAME,
  STORAGE_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { StorageReferenceService } from './storage-reference.service';

/**
 * auth-service's connection to `storage-service`.
 *
 * The gateway never calls storage-service directly (§1.5) — every upload is
 * initiated through the service that owns the resulting row, which for an
 * avatar is this one. That keeps the gateway's routing table at one owning
 * service per URL prefix, and keeps storage-service a pure utility only ever
 * called service-to-service.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        // The NATS side, for the fire-and-forget supersede event. Registered
        // here rather than injected from elsewhere, matching what
        // `AuditModule` and `NotificationsModule` already do in this service.
        name: NATS_CLIENT,
        useFactory: (configService: ConfigService) =>
          createNatsTransport(configService),
        inject: [ConfigService],
      },
      {
        name: STORAGE_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: STORAGE_PACKAGE_NAME,
            protoPath: STORAGE_PROTO_PATHS,
            url: configService.getOrThrow<string>('STORAGE_SERVICE_URL'),
            ...GRPC_CHANNEL_OPTIONS,
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [StorageReferenceService],
  exports: [StorageReferenceService],
})
export class StorageClientModule {}
