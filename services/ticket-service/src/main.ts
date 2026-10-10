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
  TICKET_PACKAGE_NAME,
  TICKET_PROTO_PATHS,
} from '@synapsedesk/grpc-proto';
import {
  ensureStream,
  JETSTREAM_CONNECTION,
  PullConsumerRunner,
  streamFor,
  AUDIT_PATTERNS,
  RecordAuditCommand,
  JETSTREAM_STREAMS,
  createNatsTransport,
} from '@synapsedesk/common';
import type { NatsConnection } from 'nats';
import { AppModule } from './app.module';
import { AuditConsumer } from './modules/audit/audit.consumer';

/**
 * A HYBRID microservice — gRPC server AND NATS consumer in one process.
 *
 * It serves TicketService/MessageService/etc. to the gateway over gRPC while
 * consuming `audit.record` and publishing `ticket.*` domain events.
 *
 * **`NestFactory.create`, not `createMicroservice`.** The latter returns an
 * `INestMicroservice`, which has no `connectMicroservice` at all — one call
 * gets one transport. Attaching a second requires an `INestApplication`.
 *
 * **`init()`, not `listen()`.** `create` builds an HTTP adapter, but this
 * service serves no HTTP and must not bind a port. `init()` runs the whole
 * lifecycle — so `onApplicationBootstrap`, and therefore the seeder, fires —
 * while leaving the adapter unbound.
 *
 * Two separate `createMicroservice` processes would mean two DI containers and
 * two Prisma pools for one logical service.
 */
async function bootstrap() {
  const logger = new Logger(AppModule.name);
  const url = `${process.env.GRPC_HOST}:${process.env.GRPC_PORT}`;

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const configService = app.get(ConfigService);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      // Domain package PLUS the ops packages. Probes and
      // `/version` ride the port this service already listens on: no HTTP
      // listener, no second port, and the kubelet speaks `grpc.health.v1`
      // natively.
      package: [TICKET_PACKAGE_NAME, ...OPS_PACKAGE_NAMES],
      protoPath: [...TICKET_PROTO_PATHS, ...OPS_PROTO_PATHS],
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

  // **Before any microservice starts.** The AUDIT stream is this service's to
  // declare, and `ensureStream` refuses a broker whose JetStream store would
  // not survive a restart — which is the one failure a durable subject must
  // never boot into, because the publisher is told it succeeded.
  const natsConnection = app.get<NatsConnection>(JETSTREAM_CONNECTION);
  const monitorUrl = configService.getOrThrow<string>('NATS_MONITOR_URL');

  await ensureStream(natsConnection, JETSTREAM_STREAMS.AUDIT, monitorUrl);
  // The DLQ is declared by whoever parks messages into it. Both services do,
  // and `ensureStream` is add-then-update, so declaring it twice is the normal
  // path rather than a conflict.
  await ensureStream(natsConnection, JETSTREAM_STREAMS.DLQ, monitorUrl);

  // The durable name is stable across restarts — that is what makes the
  // consumer durable, and what lets a redeploy resume rather than replay.
  const auditRunner = new PullConsumerRunner<RecordAuditCommand>({
    connection: natsConnection,
    // Derived from the subject rather than named here: the stream's `subjects`,
    // `DURABLE_SUBJECTS` and this line were three statements of one fact, and
    // `streamFor` throws at boot if they disagree.
    stream: streamFor(AUDIT_PATTERNS.record),
    durable: 'ticket-service-audit-writer',
    filterSubject: AUDIT_PATTERNS.record,
    handler: (command) => app.get(AuditConsumer).record(command),
  });
  await auditRunner.start();

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
