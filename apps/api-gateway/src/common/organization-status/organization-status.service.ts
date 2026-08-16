import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import {
  AUTH_GRPC_CLIENT,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  packRequestContext,
  fromProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import { firstValueFrom } from 'rxjs';
import { OrgStatus, UNKNOWN_ORIGIN } from '@synapsedesk/common';

/** What the gate needs to decide, and nothing else. */
export type OrganizationState = {
  status: OrgStatus;
  deleted: boolean;
};

/**
 * How long a status decision is trusted.
 *
 * Short on purpose: this is the window in which a tenant frozen for abuse keeps
 * working. Thirty seconds is a bounded, statable exposure — where the previous
 * behaviour (no gate at all) was "until the access token expires", up to 15
 * minutes. Longer would save little: the lookup is one indexed read behind a
 * cache that already absorbs the load.
 */
const STATUS_CACHE_TTL_SECONDS = 30;

const CACHE_PREFIX = 'org-status:';

/**
 * The tenant lifecycle state, cached.
 *
 * Sits in front of a gRPC call because the gate runs on essentially every
 * authenticated request — uncached, it would double the gateway's chattiness
 * with auth-service for a value that changes a handful of times in a tenant's
 * life.
 *
 * Redis rather than an in-process map, for the same reason the throttler uses
 * Redis: a freeze must take effect across every replica, not just the one that
 * happened to serve the status change.
 */
@Injectable()
export class OrganizationStatusService implements OnModuleInit {
  private readonly logger = new Logger(OrganizationStatusService.name);
  private readonly redis: Redis;
  private organizationGrpcService!: OrganizationServiceClient;

  constructor(
    @Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc,
    redis: RedisService,
  ) {
    // The SHARED connection This service opened its own, with its
    // own shutdown hook, to run two commands; that is a connection and a
    // lifecycle written a fourth time for no property the shared one lacks.
    this.redis = redis.client;
  }

  onModuleInit(): void {
    this.organizationGrpcService =
      this.client.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
  }

  async get(organizationId: string): Promise<OrganizationState> {
    const cached = await this.readCache(organizationId);
    if (cached) return cached;

    const response = await firstValueFrom(
      this.organizationGrpcService.getOrganizationStatus(
        { organizationId },
        // No caller identity: the RPC is by id and unscoped, and the id came
        // from a JWT this gateway just verified.
        packRequestContext(UNKNOWN_ORIGIN),
      ),
    );

    const state: OrganizationState = {
      // `?? OrgStatus.FROZEN` — an UNSPECIFIED status means the tenant's state
      // could not be read, and this cache gates every request. Failing CLOSED
      // is the only safe reading: the alternative caches "usable" for a tenant
      // whose real status is unknown.
      status: fromProtoOrgStatus(response.status) ?? OrgStatus.FROZEN,
      deleted: response.deleted,
    };

    await this.writeCache(organizationId, state);

    return state;
  }

  /**
   * Drops the cached decision immediately.
   *
   * Called by the platform status endpoints. Without it a freeze would not take
   * effect for up to the TTL, which is exactly the wrong direction for the one
   * action an operator takes when something is going wrong right now.
   */
  async invalidate(organizationId: string): Promise<void> {
    try {
      await this.redis.del(`${CACHE_PREFIX}${organizationId}`);
    } catch (error) {
      // Non-fatal: the entry expires on its own within the TTL.
      this.logger.warn(
        `Could not invalidate cached status for ${organizationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * A cache read failure is NOT an error path.
   *
   * Redis being unavailable must degrade to "ask auth-service every time",
   * which is slower but correct — not to a 500 on every authenticated request.
   */
  private async readCache(
    organizationId: string,
  ): Promise<OrganizationState | null> {
    try {
      const raw = await this.redis.get(`${CACHE_PREFIX}${organizationId}`);
      return raw ? (JSON.parse(raw) as OrganizationState) : null;
    } catch (error) {
      this.logger.warn(
        `Status cache unavailable, falling through to auth-service: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async writeCache(
    organizationId: string,
    state: OrganizationState,
  ): Promise<void> {
    try {
      await this.redis.set(
        `${CACHE_PREFIX}${organizationId}`,
        JSON.stringify(state),
        'EX',
        STATUS_CACHE_TTL_SECONDS,
      );
    } catch {
      // Same reasoning as readCache: losing the cache costs latency, not
      // correctness, so it must not fail the request.
    }
  }
}
