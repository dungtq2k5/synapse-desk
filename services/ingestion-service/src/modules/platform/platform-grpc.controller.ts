import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import { requireSuperAdmin } from '@synapsedesk/nest-common';
import {
  IngestionPlatformServiceController,
  IngestionPlatformServiceControllerMethods,
  PlatformUsageRequest,
  PlatformUsageResponse,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { PlatformUsageService } from './platform.service';

/**
 * Authorization is checked at the GATEWAY, in `SuperAdminGuard`, and again
 * here: the answer spans every tenant, so a caller that skipped the gateway
 * must still be a Super Admin.
 *
 * The context is read for that check only. This RPC has no tenant by design,
 * and filtering by one would make it look tenant-scoped when it is not.
 */
@Controller()
@IngestionPlatformServiceControllerMethods()
export class PlatformGrpcController implements IngestionPlatformServiceController {
  constructor(private readonly usage: PlatformUsageService) {}

  getPlatformUsage(
    request: PlatformUsageRequest,
    metadata?: Metadata,
  ): Promise<PlatformUsageResponse> {
    requireSuperAdmin(unpackCallerContext(metadata));
    return this.usage.getPlatformUsage(request);
  }
}
