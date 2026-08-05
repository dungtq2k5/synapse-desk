import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  INGESTION_GRPC_CLIENT,
  INGESTION_PACKAGE_NAME,
  INGESTION_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';

/**
 * The gateway's single connection to ingestion-service.
 *
 * `@Global` for the same reason `TicketGrpcModule` is: Domain C's surface will
 * spread across several gateway modules (documents now, knowledge search and
 * ingestion jobs later) and every one of them must share ONE channel.
 * Registering per module would open several connections to one peer, each with
 * its own keepalive.
 */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: INGESTION_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: INGESTION_PACKAGE_NAME,
            protoPath: INGESTION_PROTO_PATHS,
            url: configService.getOrThrow<string>('INGESTION_SERVICE_URL'),
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
export class IngestionGrpcModule {}
