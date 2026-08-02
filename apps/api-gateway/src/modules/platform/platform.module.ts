import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformGrpcClient } from './platform-grpc.client';

/**
 * `OrganizationStatusService` is not imported here — `OrganizationStatusModule`
 * is `@Global`, because the lifecycle interceptor it feeds is instantiated in
 * the root injector.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformGrpcClient],
})
export class PlatformModule {}
