import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsGrpcClient } from './audit-logs-grpc.client';
import {
  AuditLogsController,
  PlatformAuditLogsController,
} from './audit-logs.controller';

@Module({
  imports: [AuthModule],
  controllers: [AuditLogsController, PlatformAuditLogsController],
  providers: [AuditLogsGrpcClient],
  exports: [AuditLogsGrpcClient],
})
export class AuditLogsModule {}
