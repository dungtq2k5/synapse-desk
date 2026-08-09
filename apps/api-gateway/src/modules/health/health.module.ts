import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { VersionController } from './version.controller';
import { ServiceRegistry } from './service-registry.service';
import { RedisHealthService } from './redis-health.service';

@Module({
  controllers: [HealthController, VersionController],
  // `RedisHealthService` owns its own connection rather than reusing the
  // throttler's or the adapter's — see the class note. A shared client queues
  // commands while disconnected, which turns the one probe that must fail fast
  // into the one that hangs.
  providers: [ServiceRegistry, RedisHealthService],
})
export class HealthModule {}
