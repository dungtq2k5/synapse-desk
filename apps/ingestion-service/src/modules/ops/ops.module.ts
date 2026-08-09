import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import type Redis from 'ioredis';
import {
  GrpcHealthService,
  NATS_CLIENT,
  natsProbe,
  postgresProbe,
  readBuildInfo,
  redisProbe,
} from '@synapsedesk/common';
import { BUILD_INFO, OpsGrpcController } from '@synapsedesk/grpc-proto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AiLedgerModule } from '../ai-ledger/ai-ledger.module';
import { QUOTA_REDIS } from '../ai-ledger/quota-counter.service';
import { QdrantService } from '../qdrant/qdrant.service';

/**
 * `grpc.health.v1.Health` and `synapsedesk.ops.OpsService` — 23-doc §2, §3.
 *
 * **Four dependencies, and Qdrant is the one that distinguishes this service.**
 * A document that parses and cannot be upserted is a job that will fail, so an
 * ingestion-service that reports ready without a vector store is accepting work
 * it will lose.
 *
 * What is deliberately ABSENT is auth-service, which this service calls for
 * entitlements on every document write. Depending on something is not the same
 * as being unable to serve without it — and treating it as such is how a single
 * Postgres failure in one service becomes a cluster-wide not-ready (§2).
 */
@Module({
  imports: [PrismaModule, AiLedgerModule],
  controllers: [OpsGrpcController],
  providers: [
    {
      provide: GrpcHealthService,
      useFactory: (
        prisma: PrismaService,
        nats: ClientProxy,
        redis: Redis,
        qdrant: QdrantService,
      ) =>
        new GrpcHealthService([
          postgresProbe(prisma),
          natsProbe(nats),
          // The quota counter's client, reused rather than re-dialled.
          redisProbe(redis),
          {
            name: 'qdrant',
            check: () => qdrant.isReachable(),
          },
        ]),
      inject: [PrismaService, NATS_CLIENT, QUOTA_REDIS, QdrantService],
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
