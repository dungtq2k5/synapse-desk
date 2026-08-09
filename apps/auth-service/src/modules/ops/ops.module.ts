import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GrpcHealthService,
  postgresProbe,
  readBuildInfo,
} from '@synapsedesk/common';
import { BUILD_INFO, OpsGrpcController } from '@synapsedesk/grpc-proto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `grpc.health.v1.Health` and `synapsedesk.ops.OpsService` — 23-doc §2, §3.
 *
 * **auth-service checks its Postgres, and nothing else.** It is called by every
 * other service in the system and calls none of them, so there is nothing else
 * it could be tempted to check — which makes it the clearest statement of the
 * rule: *each service answers for its own dependencies*. A service that probed
 * its callers would turn one database failure into a cluster-wide not-ready by
 * exactly the mechanism the gateway's readiness bug used (§1).
 *
 * The controller and the decision logic are shared; only this wiring is local,
 * because only this service knows what it owns.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OpsGrpcController],
  providers: [
    {
      provide: GrpcHealthService,
      useFactory: (prisma: PrismaService) =>
        new GrpcHealthService([postgresProbe(prisma)]),
      inject: [PrismaService],
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

  /**
   * Readiness goes red BEFORE the port closes.
   *
   * Without this the pod keeps answering SERVING right up to the moment it stops
   * listening, so the load balancer keeps sending it work it will never finish —
   * turning every rolling deploy into a small burst of failed requests.
   */
  onApplicationShutdown(): void {
    this.health.startDraining();
  }
}
