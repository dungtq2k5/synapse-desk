import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { OrganizationStatusService } from './organization-status.service';

/**
 * `@Global` because the lifecycle interceptor is registered with APP_INTERCEPTOR
 * and is therefore instantiated in the ROOT injector — it cannot see providers
 * exported by a feature module unless they are globally available.
 *
 * Imports AuthModule for `AUTH_GRPC_CLIENT`, reusing the one connection to
 * auth-service rather than opening a second for a single small RPC.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [OrganizationStatusService],
  exports: [OrganizationStatusService],
})
export class OrganizationStatusModule {}
