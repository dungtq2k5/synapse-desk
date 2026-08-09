import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  GrpcHealthService,
  NATS_CLIENT,
  natsProbe,
  postgresProbe,
  readBuildInfo,
} from '@synapsedesk/common';
import { BUILD_INFO, OpsGrpcController } from '@synapsedesk/grpc-proto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `grpc.health.v1.Health` and `synapsedesk.ops.OpsService` — 23-doc §2, §3.
 *
 * **Postgres and NATS**, because this service is a NATS consumer with a feed
 * table and nothing else. Notably NOT the SMTP host or the SMS provider: those
 * are outbound integrations whose failure means a retry, not an inability to
 * accept work. Putting a third party in a readiness probe hands them the power
 * to take this service out of rotation.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OpsGrpcController],
  providers: [
    {
      provide: GrpcHealthService,
      useFactory: (prisma: PrismaService, nats: ClientProxy) =>
        new GrpcHealthService([postgresProbe(prisma), natsProbe(nats)]),
      inject: [PrismaService, NATS_CLIENT],
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
