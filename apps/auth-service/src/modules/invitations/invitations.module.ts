import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { InvitationsService } from './invitations.service';
import { InvitationsGrpcController } from './invitations-grpc.controller';
import { InvitationsExpiryJob } from './invitations-expiry.job';

/**
 * Imports AuthModule for `AuthService` — accepting an invitation must issue a
 * session, and session minting lives there.
 */
@Module({
  imports: [PrismaModule, NotificationsModule, AuthModule],
  controllers: [InvitationsGrpcController],
  providers: [InvitationsService, InvitationsExpiryJob],
})
export class InvitationsModule {}
