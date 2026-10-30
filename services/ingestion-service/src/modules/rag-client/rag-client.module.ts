import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  RAG_GRPC_CLIENT,
  RAG_PACKAGE_NAME,
  RAG_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { RagReferenceService } from './rag-reference.service';

/**
 * ingestion-service's connection to rag-service, for the `CONFLICTING`
 * judge: generation, its boundary and its billing live there.
 *
 * Always registered so DI resolves; the URL is optional only under test,
 * where suites fake the judge.
 */
@Global()
@Module({
  imports: [
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
    ]),
  ],
  providers: [RagReferenceService],
  exports: [RagReferenceService],
})
export class RagClientModule {}
