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
import { TicketReferenceService } from './ticket-reference.service';

/**
 * ingestion-service's connection to ticket-service.
 *
 * For `NEGATIVE_FEEDBACK`: the ratings of AI answers live with the answers, in
 * ticket-service, and the flag policy lives here, in `DocumentFlagWriter`.
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
  providers: [TicketReferenceService],
  exports: [TicketReferenceService],
})
export class TicketClientModule {}
