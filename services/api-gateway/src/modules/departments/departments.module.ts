import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DepartmentsController } from './departments.controller';
import { DepartmentsGrpcClient } from './departments-grpc.client';
import { DepartmentsService } from './departments.service';
import { DepartmentsResolver } from './departments.resolver';

/**
 * Imports AuthModule for `AUTH_GRPC_CLIENT` and the JWT guards, reusing the one
 * connection to auth-service rather than registering a second client for the
 * same peer.
 *
 * KNOWN GAP: no rate limiting. `@nestjs/throttler` is not installed, so the
 * blanket "100/min/user" backstop in the remaining-work plan does not
 * apply to these routes yet.
 */
@Module({
  imports: [AuthModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsGrpcClient, DepartmentsService, DepartmentsResolver],
  // Exported for the GraphQL resolver. The resolver calls the SAME
  // client the controller calls; a second one would be a second path to the
  // same read, which is the thing a "transport, not an implementation"
  // resolver must not become.
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
