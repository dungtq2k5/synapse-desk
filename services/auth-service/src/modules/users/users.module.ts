import { Module } from '@nestjs/common';
import { ExpiredLockSweep } from './expired-lock.sweep';
import { UsersService } from './users.service';
import { UsersGrpcController } from './users-grpc.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RolesModule } from '../roles/roles.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { StorageClientModule } from '../storage-client/storage-client.module';

/**
 * Imports RolesModule because every role grant must go through
 * `RolesService.setUserRoles` — that is where tenant validation, the
 * no-escalation rule and the `user_assigned` counter live, and a second copy of
 * any of them would drift.
 *
 * Imports StorageClientModule because auth-service OWNS `users.avatar_url`, so
 * it is the service that initiates an avatar upload and calls storage-service
 * internally — the gateway never talks to storage-service directly.
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
    StorageClientModule,
  ],
  controllers: [UsersGrpcController],
  providers: [ExpiredLockSweep, UsersService],
  exports: [ExpiredLockSweep, UsersService],
})
export class UsersModule {}
