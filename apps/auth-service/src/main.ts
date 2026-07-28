// Populates process.env before the transport options below are computed.
// ConfigModule re-reads and Joi-validates the same values during module init.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATH,
  GRPC_LOADER_OPTIONS,
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
        package: AUTH_PACKAGE_NAME,
        protoPath: AUTH_PROTO_PATH,
        url,
        // ASK What are these properties, should we put them in .env or app.config.ts
        maxReceiveMessageLength: 10 * 1024 * 1024,
        maxSendMessageLength: 10 * 1024 * 1024,
        keepaliveTime: 30_000,
        keepaliveTimeout: 10_000,
        // Must match the gateway's loader options or the two sides disagree
        // on field casing and 64-bit number representation.
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
