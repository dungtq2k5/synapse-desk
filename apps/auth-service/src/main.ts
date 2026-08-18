// Populates process.env before the transport options below are computed.
// ConfigModule re-reads and Joi-validates the same values during module init.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATHS,
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  OPS_PACKAGE_NAMES,
  OPS_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger(AppModule.name);
  const url = `${process.env.GRPC_HOST}:${process.env.GRPC_PORT}`;

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        // The domain package PLUS the ops packages. Both fields
        // take arrays, so probes and `/version` ride the port this service
        // already listens on: no HTTP listener, no second port, and the kubelet
        // speaks `grpc.health.v1` natively.
        package: [AUTH_PACKAGE_NAME, ...OPS_PACKAGE_NAMES],
        protoPath: [...AUTH_PROTO_PATHS, ...OPS_PROTO_PATHS],
        url,
        ...GRPC_CHANNEL_OPTIONS,
        loader: GRPC_LOADER_OPTIONS,
      },
    },
  );

  // Lets Prisma disconnect cleanly on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  await app.listen();
  logger.log(`🔐 [Auth Service] gRPC server listening on ${url}`);
}

bootstrap().catch((error) => {
  console.error('[Auth Service] Failed to start the application: ', error);
  process.exit(1);
});
