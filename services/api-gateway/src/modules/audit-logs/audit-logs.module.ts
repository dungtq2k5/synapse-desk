import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditLogsGrpcClient } from './audit-logs-grpc.client';
import { AuditLogsService } from './audit-logs.service';
import { PlatformGrpcClient } from '../platform/platform-grpc.client';
import {
  AuditLogsController,
  PlatformAuditLogsController,
} from './audit-logs.controller';

@Module({
  // For `AnalyticsService`: the export lifecycle is shared, and this module
  // owns the route rather than a second copy of it.
  imports: [AuthModule, AnalyticsModule],
  controllers: [AuditLogsController, PlatformAuditLogsController],
  // The platform client, for the names on the platform trail.
  providers: [AuditLogsGrpcClient, AuditLogsService, PlatformGrpcClient],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
