import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SessionsService } from './sessions.service';
import { SessionsGrpcController } from './sessions-grpc.controller';

/**
 * Exports SessionsService because `POST /auth/logout/all`, `PATCH
 * /auth/password` and (later) user lock/delete all need to revoke sessions in
 * bulk. Routing them through one method is what keeps "does revocation take
 * device trust with it?" a single answer rather than four.
 */
@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [SessionsGrpcController],
  // The expired-records pruner has moved to `SchedulerModule`.
  // It used to live here and run itself via `@Cron`; it is a plain method now,
  // and the module that owns the CLOCK owns it, so there is one place to look
  // for what runs when.
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
