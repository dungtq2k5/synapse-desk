import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsGrpcClient } from './audit-logs-grpc.client';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditLogsController,
  PlatformAuditLogsController,
} from './audit-logs.controller';

@Module({
  imports: [AuthModule],
  controllers: [AuditLogsController, PlatformAuditLogsController],
  providers: [AuditLogsGrpcClient, AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
