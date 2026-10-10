import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { RolesService } from './roles.service';
import { RolesGrpcController } from './roles-grpc.controller';

/**
 * Exports RolesService because `roles.user_assigned` is a denormalized counter
 * that MUST be adjusted in the same transaction as every junction write — from
 * user creation, role assignment, deletion and invitation acceptance alike.
 * Routing all of them through `setUserRoles`/`releaseUserRoles` is what keeps
 * the counter from drifting, and drift there eventually blocks a legitimate
 * role delete or permits a destructive one.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [RolesGrpcController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
