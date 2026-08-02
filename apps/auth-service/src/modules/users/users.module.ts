import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersGrpcController } from './users-grpc.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RolesModule } from '../roles/roles.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OrganizationsModule } from '../organizations/organizations.module';

/**
 * Imports RolesModule because every role grant must go through
 * `RolesService.setUserRoles` — that is where tenant validation, the
 * no-escalation rule and the `user_assigned` counter live, and a second copy of
 * any of them would drift.
 *
 * Imports SessionsModule because deactivating or locking a user must revoke
 * their sessions in the same operation: otherwise they keep working until their
 * access token expires, which is up to 15 minutes after being removed.
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    NotificationsModule,
    RolesModule,
    SessionsModule,
    OrganizationsModule,
  ],
  controllers: [UsersGrpcController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
