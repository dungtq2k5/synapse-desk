import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { formatErrorMsg, RequestContext } from '@synapsedesk/common';
import {
  GRPC_DEADLINE_MS,
  INGESTION_GRPC_CLIENT,
  INGESTION_PLATFORM_SERVICE_NAME,
  packRequestContext,
  type IngestionPlatformServiceClient,
  type TenantUsage,
} from '@synapsedesk/grpc-proto';

/** A leg that answered, or the reason it did not. */
export type UsageLeg =
  { value: Map<string, TenantUsage> } | { failure: string };

/**
 * Ingestion's cross-tenant usage read, from the gateway.
 *
 * **The gateway is the caller because nothing else can be.** `auth-service`
 * computes the plan projection and cannot dial ingestion: ingestion already
 * dials auth on every presign, so that edge would close a cycle on the identity
 * leaf. The gateway holds both clients already and is where fan-out lives —
 * `AnalyticsGrpcClient` states the position outright, and `PlatformJobsService`
 * merges three services the same way.
 *
 * **`tryLeg` rather than a throw**, and that is what makes the coverage list
 * honest: an unavailable ingestion drops `storage` and `documents` from the
 * dimensions a run reports, instead of failing a dry run that could still
 * answer seats — or worse, reporting nobody affected for two dimensions nothing
 * looked at.
 */
@Injectable()
export class PlatformUsageClient implements OnModuleInit {
  private readonly logger = new Logger(PlatformUsageClient.name);
  private usageService!: IngestionPlatformServiceClient;

  constructor(
    @Inject(INGESTION_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.usageService = this.client.getService<IngestionPlatformServiceClient>(
      INGESTION_PLATFORM_SERVICE_NAME,
    );
  }

  /**
   * Usage for every id, keyed for lookup — or a named failure.
   *
   * ONE call for N tenants: the projection asks about every subscriber of a
   * plan, and the per-tenant loop is exactly what this surface replaced.
   *
   * @param organizationIds every subscriber the projection is about.
   */
  async usageFor(
    organizationIds: string[],
    context: RequestContext,
  ): Promise<UsageLeg> {
    if (organizationIds.length === 0) return { value: new Map() };

    try {
      const response = await firstValueFrom(
        this.usageService
          .getPlatformUsage({ organizationIds }, packRequestContext(context))
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );

      return {
        value: new Map(response.usage.map((row) => [row.organizationId, row])),
      };
    } catch (error) {
      const reason = formatErrorMsg(error);
      // WARN, not error: the caller degrades rather than fails, and a dry run
      // that answered seats is more useful than one that answered nothing.
      this.logger.warn(`Usage leg 'ingestion-service' unavailable: ${reason}`);

      return { failure: reason };
    }
  }
}
