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

/**
 * The gateway's single connection to `rag-service` — the one Python peer.
 *
 * Same shape as every other channel here, and one thing genuinely different:
 * the package name must match a string in ANOTHER LANGUAGE. Python's generated
 * stubs derive their service path from the same `package` line in the same
 * .proto, so a mismatch is not a compile error on either side — it is an
 * UNIMPLEMENTED at runtime, from a server that is running and healthy.
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
            url: configService.getOrThrow<string>('RAG_SERVICE_URL'),
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
export class RagGrpcModule {}
