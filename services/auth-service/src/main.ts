// Populates process.env before the transport options below are computed.
// ConfigModule re-reads and Joi-validates the same values during module init.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ensureStream,
  JETSTREAM_CONNECTION,
  JETSTREAM_STREAMS,
} from '@synapsedesk/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  AUTH_PACKAGE_NAME,
  AUTH_PROTO_PATHS,
  GRPC_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  OPS_PACKAGE_NAMES,
  OPS_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import type { NatsConnection } from 'nats';
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

  // **A PUBLISHER declares the streams it publishes to, not just the consumer.**
  // A publish to a subject no stream captures fails with a 503, so if this
  // service booted before the one that owns the stream, every audit act in that
  // window would be logged as a failure and lost — the exact hole ADR 0041
  // exists to close. `ensureStream` is idempotent, so both ends declaring is
  // cheaper than a boot ordering nothing enforces.
  const natsConnection = app.get<NatsConnection>(JETSTREAM_CONNECTION);
  const monitorUrl = app
    .get<ConfigService>(ConfigService)
    .getOrThrow<string>('NATS_MONITOR_URL');

  await ensureStream(natsConnection, JETSTREAM_STREAMS.AUDIT, monitorUrl);

  // NOTIFICATIONS too: transactional mail is published from here.
  await ensureStream(
    natsConnection,
    JETSTREAM_STREAMS.NOTIFICATIONS,
    monitorUrl,
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
