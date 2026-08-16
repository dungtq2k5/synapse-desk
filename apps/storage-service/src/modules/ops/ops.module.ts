import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientsModule } from '@nestjs/microservices';
import {
  createNatsTransport,
  GrpcHealthService,
  NATS_CLIENT,
  natsProbe,
  readBuildInfo,
} from '@synapsedesk/common';
import { BUILD_INFO, OpsGrpcController } from '@synapsedesk/grpc-proto';
import { FirebaseStorageModule } from '../firebase/firebase-storage.module';
import { FirebaseStorageService } from '../firebase/firebase-storage.service';

/**
 * `grpc.health.v1.Health` and `synapsedesk.ops.OpsService`
 *
 * **No Postgres**: this service has no database at all. Its readiness is NATS —
 * it consumes `storage.object.superseded`, so a broker it cannot reach means
 * deletions silently stop — plus a Firebase credential check that makes no
 * network call.
 *
 * **The NATS client here is a second connection, and that is a deliberate
 * trade.** `main.ts` connects NATS as a microservice CONSUMER, and that
 * connection is owned by the transport rather than exposed through DI, so there
 * is nothing to borrow. One extra long-lived connection per pod buys the ability
 * to notice a broker outage; the rule §2 test 4 states is that a probe must not
 * dial PER PROBE, and this dials once at boot.
 */
@Module({
  imports: [
    FirebaseStorageModule,
    ClientsModule.registerAsync([
      {
        name: NATS_CLIENT,
        useFactory: (configService: ConfigService) =>
          createNatsTransport(configService),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [OpsGrpcController],
  providers: [
    {
      provide: GrpcHealthService,
      useFactory: (nats: ClientProxy, firebase: FirebaseStorageService) =>
        new GrpcHealthService([
          natsProbe(nats),
          {
            name: 'firebase-credential',
            // Local only — see `isConfigured`. A probe that called GCS would
            // hand Google the power to take this service out of rotation.
            check: () => Promise.resolve(firebase.isConfigured()),
          },
        ]),
      inject: [NATS_CLIENT, FirebaseStorageService],
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
