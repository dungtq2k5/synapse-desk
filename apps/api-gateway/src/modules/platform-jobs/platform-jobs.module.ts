import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformJobsClient } from './platform-jobs.client';
import { PlatformJobsController } from './platform-jobs.controller';
import { PlatformJobsService } from './platform-jobs.service';

/**
 * `/platform/jobs`
 *
 * Separate from `PlatformModule` because it talks to ticket-service and
 * ingestion-service rather than to auth-service: the heartbeat tables live
 * where the jobs run. Folding it in would put three gRPC clients in a module
 * whose whole subject is the auth domain.
 */
@Module({
  // The gRPC channels are `@Global`, so this opens no new connections —
  // `AuthModule` is here only for the guards.
  imports: [AuthModule],
  controllers: [PlatformJobsController],
  providers: [PlatformJobsClient, PlatformJobsService],
  // Exported for the metrics collector The Prometheus gauge reads
  // the SAME heartbeats this endpoint reports, deliberately: a second reader
  // with its own staleness rule would eventually disagree with the page an
  // operator is looking at.
  exports: [PlatformJobsService],
})
export class PlatformJobsModule {}
