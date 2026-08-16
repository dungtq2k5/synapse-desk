import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  GrpcHealthService,
  NATS_CLIENT,
  postgresProbe,
  natsProbe,
  readBuildInfo,
  SCHEDULER_QUEUE,
} from '@synapsedesk/common';
import { BUILD_INFO, OpsGrpcController } from '@synapsedesk/grpc-proto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * `grpc.health.v1.Health` and `synapsedesk.ops.OpsService`
 *
 * **ticket-service owns three things and checks exactly those three**: its
 * Postgres, NATS, and the Redis its BullMQ queues run on. It calls auth-service
 * on nearly every write and auth-service is deliberately NOT here — that is the
 * rule §2 exists to state, and it is the one that decays first, because "we
 * depend on it, so check it" always sounds like diligence. It is how one
 * database failure becomes a cluster-wide not-ready.
 *
 * The Redis probe goes through the SCHEDULER queue's existing client rather
 * than a new connection: a probe every five seconds that dials is a connection
 * leak with a schedule (§2 test 4).
 */
@Module({
  imports: [
    PrismaModule,
    // For the queue whose Redis connection the probe borrows. `AnalyticsModule`
    // owns `BullModule.forRoot` in this service, so importing it is what makes
    // the root config available here without registering a second one.
    AnalyticsModule,
    BullModule.registerQueue({ name: SCHEDULER_QUEUE.ticket }),
  ],
  controllers: [OpsGrpcController],
  providers: [
    {
      provide: GrpcHealthService,
      useFactory: (prisma: PrismaService, nats: ClientProxy, queue: Queue) =>
        new GrpcHealthService([
          postgresProbe(prisma),
          natsProbe(nats),
          // `queue.client` is the connection BullMQ already holds, so this
          // opens nothing. `info()` rather than `ping()` because BullMQ's
          // `IRedisClient` abstracts over ioredis and node-redis and only the
          // former has PING — and reaching past the interface to the concrete
          // client is how a probe starts depending on which driver is
          // configured.
          {
            name: 'bullmq-redis',
            check: async () => {
              const client = await queue.client;
              return (await client.info()).length > 0;
            },
          },
        ]),
      inject: [
        PrismaService,
        NATS_CLIENT,
        getQueueToken(SCHEDULER_QUEUE.ticket),
      ],
    },
    {
      provide: BUILD_INFO,
      useFactory: (configService: ConfigService) =>
        readBuildInfo(configService),
      inject: [ConfigService],
    },
  ],
})
export class OpsModule implements OnApplicationShutdown {
  constructor(private readonly health: GrpcHealthService) {}

  /** Readiness goes red before the port closes — see auth-service's copy. */
  onApplicationShutdown(): void {
    this.health.startDraining();
  }
}
