import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsGrpcClient } from './invitations-grpc.client';
import { InvitationsService } from './invitations.service';

/**
 * Imports AuthModule for `AUTH_GRPC_CLIENT` and `JwtCookieService` — accepting
 * an invitation issues a session, so it sets the same cookies `/auth/login`
 * does, and reuses the same peer connection rather than opening a second one.
 *
 * KNOWN GAP: `GET /users/invitations/:token` is public and should carry an IP
 * rate limit. `@nestjs/throttler` is not installed, so it does not yet.
 */
@Module({
  imports: [AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationsGrpcClient, InvitationsService],
})
export class InvitationsModule {}
