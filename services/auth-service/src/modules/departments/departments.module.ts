import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageClientModule } from '../storage-client/storage-client.module';
import { AuditModule } from '../audit/audit.module';
import { DepartmentsService } from './departments.service';
import { DepartmentsGrpcController } from './departments-grpc.controller';

@Module({
  imports: [PrismaModule, AuditModule, StorageClientModule],
  controllers: [DepartmentsGrpcController],
  providers: [DepartmentsService],
  // Exported for UsersModule: assigning a user's departments needs the same tenant and
  // primary-department validation this service already owns.
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
