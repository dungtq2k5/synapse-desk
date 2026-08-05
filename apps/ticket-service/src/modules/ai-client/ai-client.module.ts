import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  INGESTION_GRPC_CLIENT,
  INGESTION_PACKAGE_NAME,
  INGESTION_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { RagClientService } from './rag-client.service';
import { LedgerClientService } from './ledger-client.service';

/**
 * The `rag-service` seam, in its own module so both the message thread
 * (`invokeAi`, §2.5) and the AI Co-Pilot surface (§2.6) share one instance and
 * one availability check.
 */
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
            // Optional in the same sense `RAG_SERVICE_URL` is: ticket-service
            // predates Domain C and must still boot without it. An unset URL
            // makes the outcome write fail and be logged, which costs a
            // metric — not a reply.
            url:
              configService.get<string>('INGESTION_SERVICE_URL') ??
              'localhost:0',
            ...GRPC_CHANNEL_OPTIONS,
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [RagClientService, LedgerClientService],
  exports: [RagClientService, LedgerClientService],
})
export class AiClientModule {}
