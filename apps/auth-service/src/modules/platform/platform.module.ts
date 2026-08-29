import { Module } from '@nestjs/common';
import { JobRunsModule } from '../job-runs/job-runs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { RolesModule } from '../roles/roles.module';
import { BillingModule } from '../billing/billing.module';
import { LimitAlertsModule } from '../limit-alerts/limit-alerts.module';
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
    // For `PlanAdminService`. The catalogue tables belong to billing; the
    // ADMIN surface over them belongs behind `SuperAdminGuard` with the rest of
    // the cross-tenant writes, so the controller lives here and the service
    // stays where its tables are.
    BillingModule,
    LimitAlertsModule,
  ],
  controllers: [PlatformGrpcController],
  providers: [PlatformService],
})
export class PlatformModule {}
