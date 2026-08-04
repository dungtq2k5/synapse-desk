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
  TICKET_PACKAGE_NAME,
  TICKET_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import { createNatsTransport } from '@synapsedesk/common';
import { AppModule } from './app.module';

/**
 * A HYBRID microservice — gRPC server AND NATS consumer in one process.
 *
 * auth-service is pure gRPC: it publishes to NATS but never subscribes.
 * ticket-service is the first service here that must do both — it serves
 * TicketService/MessageService/etc. to the gateway over gRPC, while consuming
 * `audit.record` and publishing `ticket.*` domain events.
 *
 * **`NestFactory.create`, not `createMicroservice`.** That is not a stylistic
 * choice: `createMicroservice` returns an `INestMicroservice`, which has no
 * `connectMicroservice` at all — one call gets exactly one transport. Attaching
 * a second requires an `INestApplication`, which only `create` returns.
 *
 * **`init()`, not `listen()`.** `create` builds an HTTP adapter, but this
 * service serves no HTTP and must not bind a port — `init()` runs the whole
 * lifecycle (so `onApplicationBootstrap`, and therefore the seeder, fires)
 * while leaving the adapter unbound. `listen()` here would open a port nothing
 * answers on.
 *
 * The alternative — two separate `createMicroservice` processes — would mean
 * two DI containers and two Prisma pools for one logical service, and a
 * consumer that could drift out of step with the RPC surface it shares a
 * database with.
 */
async function bootstrap() {
  const logger = new Logger(AppModule.name);
  const url = `${process.env.GRPC_HOST}:${process.env.GRPC_PORT}`;

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const configService = app.get(ConfigService);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: TICKET_PACKAGE_NAME,
      protoPath: TICKET_PROTO_PATHS,
      url,
      ...GRPC_CHANNEL_OPTIONS,
      loader: GRPC_LOADER_OPTIONS,
    },
  });

  // The same transport factory auth-service uses for its NATS CLIENT. The
  // options are identical regardless of direction, which is why one helper
  // serves both — a second copy for the server side would be the same shape
  // with a different name.
  app.connectMicroservice<MicroserviceOptions>(
    createNatsTransport(configService),
  );

  // Lets Prisma disconnect cleanly on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.init();

  logger.log(`🎫 [Ticket Service] gRPC server listening on ${url}`);
  logger.log(
    `🎫 [Ticket Service] NATS consumer connected to ${configService.getOrThrow<string>('NATS_URL')}`,
  );
}

bootstrap().catch((error) => {
  console.error('[Ticket Service] Failed to start the application: ', error);
  process.exit(1);
});
