import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsGrpcClient } from './organizations-grpc.client';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsGrpcClient],
})
export class OrganizationsModule {}
