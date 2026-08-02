import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionsController } from './sessions.controller';
import { UserSessionsController } from './user-sessions.controller';
import { SessionsGrpcClient } from './sessions-grpc.client';

/**
 * Imports AuthModule for `AUTH_GRPC_CLIENT`, the JWT guards, and
 * `JwtCookieService` — revoking your own session has to clear the same cookies
 * `/auth/logout` does, so it must use the same names and options rather than a
 * second copy of them.
 */
@Module({
  imports: [AuthModule],
  controllers: [SessionsController, UserSessionsController],
  providers: [SessionsGrpcClient],
})
export class SessionsModule {}
