import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LimitAlertsModule } from '../limit-alerts/limit-alerts.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SessionsModule } from '../sessions/sessions.module';
import { OrganizationsService } from './organizations.service';
import { OrganizationsGrpcController } from './organizations-grpc.controller';

/**
 * Exports OrganizationsService because it owns `seatsInUse` — the ONE
 * definition of "seats used", consumed by user creation and by both invitation
 * paths. It lived in two services before, which is exactly how an invite gets
 * rejected by a counter the usage page says has room.
 *
 * Imports SessionsModule because requesting offboarding must cut off access
 * immediately rather than whenever each access token expires.
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    NotificationsModule,
    SessionsModule,
    LimitAlertsModule,
  ],
  controllers: [OrganizationsGrpcController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
