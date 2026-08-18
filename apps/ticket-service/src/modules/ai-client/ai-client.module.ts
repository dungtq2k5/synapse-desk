import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  INGESTION_GRPC_CLIENT,
  INGESTION_PACKAGE_NAME,
  INGESTION_PROTO_PATHS,
  RAG_GRPC_CLIENT,
  RAG_PACKAGE_NAME,
  RAG_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { RagClientService } from './rag-client.service';
import { LedgerClientService } from './ledger-client.service';

/**
 * The `rag-service` seam, in its own module so both the message thread
 * (`invokeAi`) and the AI Co-Pilot surface share one instance and
 * one availability check.
 */
@Module({
  imports: [
    // Optional at the URL level, not at the module level: the client is always
    // registered so DI resolves, and `RagClientService` refuses at call time
    // when `RAG_SERVICE_URL` is unset. A conditional registration would make a
    // missing URL a boot crash for a feature that is allowed to be absent.
    ClientsModule.registerAsync([
      {
        name: RAG_GRPC_CLIENT,
        useFactory: (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: RAG_PACKAGE_NAME,
            protoPath: RAG_PROTO_PATHS,
            url: configService.get<string>('RAG_SERVICE_URL') ?? 'localhost:0',
            ...GRPC_CHANNEL_OPTIONS,
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
        inject: [ConfigService],
      },
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
