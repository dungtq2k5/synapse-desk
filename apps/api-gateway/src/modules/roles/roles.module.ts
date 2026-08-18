import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesController } from './roles.controller';
import { PermissionsController } from './permissions.controller';
import { RolesGrpcClient } from './roles-grpc.client';
import { RolesService } from './roles.service';

/**
 * Owns `/permissions` as well as `/roles`: the catalogue is served by the same
 * gRPC service and is only ever consumed by the role editor, so a separate
 * module would exist purely to hold one read-only route.
 */
@Module({
  imports: [AuthModule],
  controllers: [RolesController, PermissionsController],
  providers: [RolesGrpcClient, RolesService],
})
export class RolesModule {}
