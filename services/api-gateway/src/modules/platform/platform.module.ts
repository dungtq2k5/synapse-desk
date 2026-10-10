import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformGrpcClient } from './platform-grpc.client';
import { PlatformService } from './platform.service';
import { PlatformUsageClient } from './platform-usage.client';
import { IngestionGrpcModule } from '../../common/grpc/ingestion-grpc.module';

/**
 * `OrganizationStatusService` is not imported here — `OrganizationStatusModule`
 * is `@Global`, because the lifecycle interceptor it feeds is instantiated in
 * the root injector.
 */
@Module({
  // `IngestionGrpcModule` because the plan projection is composed here: auth
  // answers seats, ingestion answers storage and documents, and auth cannot ask
  // ingestion without closing a cycle on the identity leaf.
  imports: [AuthModule, IngestionGrpcModule],
  controllers: [PlatformController],
  providers: [PlatformGrpcClient, PlatformUsageClient, PlatformService],
})
export class PlatformModule {}
