import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { InvitationsService } from './invitations.service';
import { InvitationsGrpcController } from './invitations-grpc.controller';

/**
 * Imports AuthModule for `AuthService` — accepting an invitation must issue a
 * session, and session minting lives there.
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    AuthModule,
    RolesModule,
    OrganizationsModule,
  ],
  controllers: [InvitationsGrpcController],
  providers: [InvitationsService],
  // Exported for `SchedulerModule`, which drives the hourly expiry sweep —
  // It was a `@Cron` inside this module until then.
  exports: [InvitationsService],
})
export class InvitationsModule {}
