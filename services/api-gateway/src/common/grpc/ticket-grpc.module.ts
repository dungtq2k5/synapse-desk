import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  TICKET_GRPC_CLIENT,
  TICKET_PACKAGE_NAME,
  TICKET_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';

/**
 * The gateway's single connection to ticket-service.
 *
 * `@Global` and separate from any feature module because Domain B's surface is
 * spread across six services (`Ticket`, `Assignment`, `Message`, `Ai`,
 * `Feedback`, `Audit`) that will land in six different gateway modules — and
 * every one of them must share ONE channel. Registering the client per module
 * would open six connections to one peer, each with its own keepalive.
 *
 * Mirrors how `AuthModule` re-exports `ClientsModule` for `AUTH_GRPC_CLIENT`,
 * arrived at differently only because there is no natural feature module here
 * to hang it on.
 */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: TICKET_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: TICKET_PACKAGE_NAME,
            protoPath: TICKET_PROTO_PATHS,
            url: configService.getOrThrow<string>('TICKET_SERVICE_URL'),
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
export class TicketGrpcModule {}
