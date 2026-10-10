import { Controller } from '@nestjs/common';
import {
  IngestionPlatformServiceController,
  IngestionPlatformServiceControllerMethods,
  PlatformUsageRequest,
  PlatformUsageResponse,
} from '@synapsedesk/grpc-proto';
import { PlatformUsageService } from './platform.service';

/**
 * Authorization lives at the GATEWAY, in `SuperAdminGuard` — the same
 * arrangement as `auth-service`'s platform surface, and the reason nothing here
 * re-checks it.
 *
 * No `unpackCallerContext`: this RPC has no tenant by design, and reading one
 * would invite a filter that made it look tenant-scoped when it is not.
 */
@Controller()
@IngestionPlatformServiceControllerMethods()
export class PlatformGrpcController implements IngestionPlatformServiceController {
  constructor(private readonly usage: PlatformUsageService) {}

  getPlatformUsage(
    request: PlatformUsageRequest,
  ): Promise<PlatformUsageResponse> {
    return this.usage.getPlatformUsage(request);
  }
}
