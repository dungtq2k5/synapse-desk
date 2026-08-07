import { Module } from '@nestjs/common';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { RolesModule } from '../roles/roles.module';
import { PlatformService } from './platform.service';
import { PlatformGrpcController } from './platform-grpc.controller';

/**
 * Imports SessionsModule because freezing or offboarding a tenant must cut off
 * access now rather than as each access token expires, and RolesModule so the
 * first Org Admin's grant moves `roles.user_assigned` like every other path.
 */
@Module({
  imports: [
    JobRunsModule,
    PrismaModule,
    AuditModule,
    SessionsModule,
    RolesModule,
  ],
  controllers: [PlatformGrpcController],
  providers: [PlatformService],
})
export class PlatformModule {}
