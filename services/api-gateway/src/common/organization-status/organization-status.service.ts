import {
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { ClientGrpc } from '@nestjs/microservices';
import type Redis from 'ioredis';
import { BaseGrpcClient } from '../grpc/base-grpc.client';
import { RedisService } from '../redis/redis.service';
import {
  AUTH_GRPC_CLIENT,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  type OrganizationStatusResponse,
  fromProtoOrgStatus,
} from '@synapsedesk/grpc-proto';
import { OrgStatus, UNKNOWN_ORIGIN } from '@synapsedesk/contracts';
import { CacheService } from '../cache/cache.service';
import { CACHE_SCOPES } from '../config/cache.config';

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

/**
 * How long past its fresh thirty seconds a status still answers while
 * auth-service can't be reached. Redis keeps the entry this much longer, and
 * that TTL is the only bound: an entry Redis still has is served.
 */
const MAX_STALE_SECONDS = 300;

/** A cached state, and whether it is past its fresh thirty seconds. */
type Entry = { state: OrganizationState; stale: boolean };

const CACHE_PREFIX = 'org-status:';

/**
 * Each organization's generation: the cached decision's key carries it, and
 * an invalidation increments it, so a status read just before a freeze and
 * stored just after lands where no read looks. Both gateways share it.
 */
const GENERATION_PREFIX = 'org-status-gen:';

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
 *
 * The entry is `{"status":"ACTIVE","deleted":false,"freshUntil":<epoch ms>}`,
 * the same key and shape on both gateways. An entry without `freshUntil` (an
 * older replica's) is fresh for as long as Redis keeps it.
 *
 * **An auth-service outage serves the last known status, for a bounded time.**
 * Past its fresh thirty seconds the status is asked for again; if the call
 * fails with `UNAVAILABLE` or `DEADLINE_EXCEEDED`, the stale entry answers,
 * with a warning, so an outage doesn't take down every route at the
 * thirty-second mark. A stale `FROZEN` still refuses. Any other failure, and a
 * tenant with no entry, still fail the request. Every write that changes a
 * status calls {@link invalidate}, so a stale entry is never one the gateway
 * itself made obsolete.
 */
@Injectable()
export class OrganizationStatusService
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'auth-service';

  private readonly logger = new Logger(OrganizationStatusService.name);
  private readonly redis: Redis;
  private organizationGrpcService!: OrganizationServiceClient;

  constructor(
    @Inject(AUTH_GRPC_CLIENT) private readonly client: ClientGrpc,
    redis: RedisService,
    private readonly cache: CacheService,
  ) {
    super();
    // The SHARED connection. This service opened its own, with its
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
    // Read BEFORE asking auth-service: the answer is stored under the
    // generation it was asked under. Unreadable means no cache either way.
    const generation = await this.readGeneration(organizationId);
    const key =
      generation === null
        ? null
        : `${CACHE_PREFIX}${organizationId}|#${generation}`;
    const cached = key ? await this.readCache(key) : null;
    if (cached && !cached.stale) return cached.state;

    let response: OrganizationStatusResponse;
    try {
      response = await this.call(
        (metadata) =>
          this.organizationGrpcService.getOrganizationStatus(
            { organizationId },
            metadata,
          ),
        UNKNOWN_ORIGIN,
      );
    } catch (error) {
      const code = unreachableCode(error);
      if (!cached || code === null) throw error;
      this.logger.warn(
        `auth-service unreachable (${code}); serving the last known status of ${organizationId}`,
      );

      return cached.state;
    }

    const state: OrganizationState = {
      // `?? OrgStatus.FROZEN` — an UNSPECIFIED status means the tenant's state
      // could not be read, and this cache gates every request. Failing CLOSED
      // is the only safe reading: the alternative caches "usable" for a tenant
      // whose real status is unknown.
      status: fromProtoOrgStatus(response.status) ?? OrgStatus.FROZEN,
      deleted: response.deleted,
    };

    if (key) await this.writeCache(key, state);

    return state;
  }

  /**
   * Drops both of the organization's cached reads: its lifecycle status, and
   * its own `GET /organizations/current` (the `organizations` scope).
   *
   * Called by every write that changes the organization's lifecycle: the
   * platform's four writes and the tenant's own delete and onboarding. Without
   * it a freeze would not take effect for up to the TTL, which is exactly the
   * wrong direction for the one action an operator takes when something is
   * going wrong right now. One call clears both, so a new write cannot clear
   * one and miss the other.
   */
  async invalidate(organizationId: string): Promise<void> {
    // Fails open on its own, with its own line.
    await this.cache.invalidateScope(
      organizationId,
      CACHE_SCOPES.organizations,
    );
    try {
      // The generation first: a status being read right now is then stored
      // where no read looks. The delete is what an instance still on keys
      // without a generation understands.
      await this.redis.incr(`${GENERATION_PREFIX}${organizationId}`);
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
  private async readGeneration(organizationId: string): Promise<string | null> {
    try {
      return (
        (await this.redis.get(`${GENERATION_PREFIX}${organizationId}`)) ?? '0'
      );
    } catch {
      return null;
    }
  }

  /** A read failure, or a value not shaped as `writeCache` writes it, is a miss and not an error. */
  private async readCache(key: string): Promise<Entry | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;

      const value = JSON.parse(raw) as Record<string, unknown> | null;
      if (
        typeof value?.status !== 'string' ||
        typeof value.deleted !== 'boolean'
      ) {
        return null;
      }
      const { freshUntil } = value;

      return {
        state: {
          status: value.status as OrgStatus,
          deleted: value.deleted,
        },
        stale: typeof freshUntil === 'number' && freshUntil <= Date.now(),
      };
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
    key: string,
    state: OrganizationState,
  ): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify({
          status: state.status,
          deleted: state.deleted,
          freshUntil: Date.now() + STATUS_CACHE_TTL_SECONDS * 1000,
        }),
        'EX',
        STATUS_CACHE_TTL_SECONDS + MAX_STALE_SECONDS,
      );
    } catch {
      // Same reasoning as readCache: losing the cache costs latency, not
      // correctness, so it must not fail the request.
    }
  }
}

/**
 * The status name when `error` means auth-service couldn't be reached in
 * time: unreachable, a peer deadline, or this gateway's own timeout. Null for
 * anything else.
 */
function unreachableCode(error: unknown): string | null {
  if (error instanceof GatewayTimeoutException) return 'DEADLINE_EXCEEDED';
  const code = (error as { code?: unknown } | null)?.code;

  return code === GrpcStatus.UNAVAILABLE ||
    code === GrpcStatus.DEADLINE_EXCEEDED
    ? GrpcStatus[code]
    : null;
}
