import { Module, OnApplicationShutdown } from '@nestjs/common';
import { HealthController } from './health.controller';
import { VersionController } from './version.controller';
import { VersionResolver } from './version.resolver';
import { ServiceRegistry } from './service-registry.service';
import { RedisHealthService } from './redis-health.service';
import { DrainState } from './drain-state.service';

@Module({
  controllers: [HealthController, VersionController],
  // `RedisHealthService` owns its own connection rather than reusing the
  // throttler's or the adapter's — see the class note. A shared client queues
  // commands while disconnected, which turns the one probe that must fail fast
  // into the one that hangs.
  providers: [VersionResolver, ServiceRegistry, RedisHealthService, DrainState],
})
export class HealthModule implements OnApplicationShutdown {
  constructor(private readonly drain: DrainState) {}

  /**
   * Readiness goes red before the listener closes — the same hook the five gRPC
   * services carry in their `OpsModule`s, in the one place the gateway has for
   * it. See `DrainState` for why the gateway is the instance where it matters.
   */
  onApplicationShutdown(): void {
    this.drain.startDraining();
  }
}
