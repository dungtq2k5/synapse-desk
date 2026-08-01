import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ServiceRegistry } from './service-registry.service';

@Module({
  controllers: [HealthController],
  providers: [ServiceRegistry],
})
export class HealthModule {}
