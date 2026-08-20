import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditLogsGrpcClient } from './audit-logs-grpc.client';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditLogsController,
  PlatformAuditLogsController,
} from './audit-logs.controller';

@Module({
  // For `AnalyticsService`: the export lifecycle is shared, and this module
  // owns the route rather than a second copy of it.
  imports: [AuthModule, AnalyticsModule],
  controllers: [AuditLogsController, PlatformAuditLogsController],
  providers: [AuditLogsGrpcClient, AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
