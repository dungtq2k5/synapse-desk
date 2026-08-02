import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SessionsService } from './sessions.service';
import { SessionsGrpcController } from './sessions-grpc.controller';
import { ExpiredRecordsJob } from './expired-records.job';

/**
 * Exports SessionsService because `POST /auth/logout/all`, `PATCH
 * /auth/password` and (later) user lock/delete all need to revoke sessions in
 * bulk. Routing them through one method is what keeps "does revocation take
 * device trust with it?" a single answer rather than four.
 */
@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [SessionsGrpcController],
  // ExpiredRecordsJob is not exported: it runs itself on a schedule and
  // nothing else should be invoking it.
  providers: [SessionsService, ExpiredRecordsJob],
  exports: [SessionsService],
})
export class SessionsModule {}
