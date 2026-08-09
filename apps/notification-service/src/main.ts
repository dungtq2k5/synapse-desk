// Populates process.env before the transport options below are computed.
// ConfigModule re-reads and Joi-validates the same values during module init.
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
  NOTIFICATION_PACKAGE_NAME,
  NOTIFICATION_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { createNatsTransport } from '@synapsedesk/common';
import { AppModule } from './app.module';

/**
 * A HYBRID microservice — gRPC server AND NATS consumer — 18-doc §1.1.
 *
 * This service was NATS-only for its whole life: it consumed events and sent
 * mail, and owned nothing anybody could read back. The feed changes that. A
 * personal inbox is a synchronous read on behalf of a user, so the gateway
 * needs a gRPC surface exactly as it has one for ticket-service.
 *
 * **`NestFactory.create`, not `createMicroservice`.** That is not stylistic:
 * `createMicroservice` returns an `INestMicroservice`, which has no
 * `connectMicroservice` at all — one call gets exactly one transport. Attaching
 * a second requires an `INestApplication`, which only `create` returns. This
 * conversion is the reason the bootstrap test asserts the NATS consumers still
 * fire: it is the regression the change actually risks.
 *
 * **`init()`, not `listen()`.** `create` builds an HTTP adapter, but this
 * service serves no HTTP and must not bind a port — `init()` runs the whole
 * lifecycle (so `onApplicationBootstrap`, and therefore the seeder, fires)
 * while leaving the adapter unbound.
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
      package: [NOTIFICATION_PACKAGE_NAME, ...OPS_PACKAGE_NAMES],
      protoPath: [...NOTIFICATION_PROTO_PATHS, ...OPS_PROTO_PATHS],
      url,
      ...GRPC_CHANNEL_OPTIONS,
      loader: GRPC_LOADER_OPTIONS,
    },
  });

  const nats = createNatsTransport(configService);

  app.connectMicroservice<MicroserviceOptions>({
    ...nats,
    options: {
      ...nats.options,
      /**
       * A queue group, so N replicas SHARE the subscription: each message is
       * delivered to exactly one of them. Without it every replica handles
       * every event and the user gets N copies of each email — and, now that
       * this service writes rows, N notifications minus whatever the unique
       * index happens to catch.
       */
      queue: 'notification_service_queue',
    },
  });

  // Lets Prisma disconnect cleanly on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.init();

  logger.log(
    `\u{1F4EE} [Notification Service] gRPC server listening on ${url}`,
  );
  logger.log(
    `\u{1F4EE} [Notification Service] NATS consumer connected to ${configService.getOrThrow<string>(
      'NATS_URL',
    )}`,
  );
}

bootstrap().catch((error) => {
  console.error('[Notification Service] Failed to start: ', error);
  process.exit(1);
});
