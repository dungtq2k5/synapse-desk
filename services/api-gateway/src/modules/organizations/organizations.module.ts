import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsGrpcClient } from './organizations-grpc.client';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsGrpcClient, OrganizationsService],
})
export class OrganizationsModule {}
