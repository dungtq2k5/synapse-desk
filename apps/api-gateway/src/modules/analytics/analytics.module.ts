import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsGrpcClient } from './analytics-grpc.client';
import { AnalyticsCacheService } from './analytics-cache.service';

/**
 * The composition layer — and the whole of "analytics" as a deploy unit.
 *
 * **There is no `analytics-service`, and this module is why there does not need
 * to be one** (19-doc §1): the fan-out is three endpoints joining on a user or
 * document id at tens-to-hundreds of rows per tenant. A service whose entire
 * job is this would add a hop, a deploy unit and a latency budget while
 * answering no question the gateway could not.
 *
 * No gRPC client module is imported: `TicketGrpcModule`, `IngestionGrpcModule`
 * and the auth channel are all `@Global`, so this shares the existing
 * connections rather than opening a fourth.
 */
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsGrpcClient, AnalyticsCacheService],
  exports: [AnalyticsService, AnalyticsCacheService],
})
export class AnalyticsModule {}
