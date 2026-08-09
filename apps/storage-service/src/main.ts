// Populates process.env before the transport options below are computed.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  OPS_PACKAGE_NAMES,
  OPS_PROTO_PATHS,
  STORAGE_PACKAGE_NAME,
  STORAGE_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { createNatsTransport } from '@synapsedesk/common';
import { AppModule } from './app.module';

/**
 * A hybrid, same shape as ticket-service: a gRPC server for the owning
 * services, and a NATS consumer for `storage.object.superseded`.
 *
 * `NestFactory.create` + `init()` for the same two reasons: `createMicroservice`
 * returns an `INestMicroservice` with no `connectMicroservice`, so one call gets
 * one transport; and this service serves no HTTP, so `listen()` would bind a
 * port nothing answers on.
 */
async function bootstrap() {
  const logger = new Logger(AppModule.name);
  const url = `${process.env.GRPC_HOST}:${process.env.GRPC_PORT}`;

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const configService = app.get(ConfigService);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      // Domain package PLUS the ops packages — 23-doc §2. Probes and
      // `/version` ride the port this service already listens on: no HTTP
      // listener, no second port, and the kubelet speaks `grpc.health.v1`
      // natively.
      package: [STORAGE_PACKAGE_NAME, ...OPS_PACKAGE_NAMES],
      protoPath: [...STORAGE_PROTO_PATHS, ...OPS_PROTO_PATHS],
      url,
      ...GRPC_CHANNEL_OPTIONS,
      loader: GRPC_LOADER_OPTIONS,
    },
  });

  app.connectMicroservice<MicroserviceOptions>(
    createNatsTransport(configService),
  );

  // Lets the Redis client disconnect cleanly on SIGINT/SIGTERM — without this
  // the process lingers holding an open connection.
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.init();

  logger.log(`📦 [Storage Service] gRPC server listening on ${url}`);
  logger.log(
    `📦 [Storage Service] NATS consumer connected to ${configService.getOrThrow<string>('NATS_URL')}`,
  );
}

bootstrap().catch((error) => {
  console.error('[Storage Service] Failed to start the application: ', error);
  process.exit(1);
});
