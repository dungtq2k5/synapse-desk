package com.synapsedesk.gateway.lifecycle;

import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.cache.CacheService;
import com.synapsedesk.gateway.grpc.CallerMetadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import synapsedesk.auth.Common.OrgStatus;
import synapsedesk.auth.Organization.GetOrganizationStatusRequest;
import synapsedesk.auth.Organization.OrganizationStatusResponse;
import synapsedesk.auth.OrganizationServiceGrpc.OrganizationServiceBlockingStub;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The tenant lifecycle state, cached.
 *
 * <p>Sits in front of a gRPC call because the gate runs on essentially every
 * authenticated request: uncached it would double the gateway's chattiness with
 * auth-service for a value that changes a handful of times in a tenant's life.
 *
 * <p><b>Shared by every replica.</b> The decision is cached in Redis under
 * {@code org-status:<id>} as
 * {@code {"status":"ACTIVE","deleted":false,"freshUntil":<epoch ms>}}, fresh for
 * thirty seconds, so whichever replica asks next reads what another cached. An entry
 * without {@code freshUntil} is fresh for as long as Redis keeps it. In Redis rather
 * than a map in this process for the same reason the throttler is: a freeze must take effect across every replica, not
 * just the one that happened to serve the status change.
 *
 * <p><b>Thirty seconds is a deliberate trade.</b> It is the window in which a tenant
 * frozen for abuse keeps working: a bounded, statable exposure, where having no gate
 * at all meant "until the access token expires", up to 15 minutes. Longer would save
 * little (the lookup is one indexed read behind a cache that already absorbs the
 * load) and delay a freeze, which is the wrong direction for the one case this
 * exists for.
 *
 * <p><b>Fails closed, and degrades rather than fails.</b> A status the peer could not
 * read is FROZEN: this cache gates every request, and caching "usable" for a tenant
 * whose state is unknown would gate nothing. A cache that cannot be read or written
 * is not an error: Redis being down must mean "ask auth-service every time", slower
 * but correct, not a 500 on every authenticated request.
 *
 * <p><b>A peer outage serves the last known status, for a bounded time.</b> Redis
 * keeps an entry {@link #MAX_STALE} past its thirty fresh seconds. Once it is stale
 * the peer is asked again; if the peer cannot be reached, the stale entry answers, so
 * an auth-service outage does not take down every route at the thirty-second mark.
 * {@link #MAX_STALE} is therefore also how long a tenant frozen during the outage
 * keeps working. A tenant with no entry at all is NOT waved through: the request
 * fails, as it always did. Every write the gateway sees that changes a tenant's
 * status calls {@link #invalidate}, so a change made through the gateway is never
 * what a stale entry serves.
 */
@Service
public class OrganizationStatusService {

  private static final Logger LOG = LoggerFactory.getLogger(
    OrganizationStatusService.class
  );

  /** {@code STATUS_CACHE_TTL_SECONDS}. */
  static final Duration TTL = Duration.ofSeconds(30);

  /** How long past {@link #TTL} a status still answers while the peer is unreachable. */
  static final Duration MAX_STALE = Duration.ofMinutes(5);

  static final String CACHE_PREFIX = "org-status:";

  private static final long DEADLINE_SECONDS = 5;

  /** The RPC is by id and unscoped: no user and no tenant travel with it. */
  private static final RequestOrigin UNKNOWN_ORIGIN = new RequestOrigin("", "");

  /**
   * What the gate needs to decide, and nothing else.
   *
   * @param status the lifecycle state, the proto name without its prefix
   *     ({@code SUSPENDED_PAST_DUE}); see {@code nameOf}
   * @param deleted true once offboarded: distinct from any status, so a deleted
   *     tenant is refused even while its status still reads ACTIVE
   */
  public record State(String status, boolean deleted) {}

  /** A cached state, and whether it is past its fresh thirty seconds. */
  private record Entry(State state, boolean stale) {}

  private final OrganizationServiceBlockingStub organizations;
  private final StringRedisTemplate redis;
  private final ObjectMapper json;
  private final CacheService cache;

  public OrganizationStatusService(
    OrganizationServiceBlockingStub organizations,
    StringRedisTemplate redis,
    ObjectMapper json,
    CacheService cache
  ) {
    this.organizations = organizations;
    this.redis = redis;
    this.json = json;
    this.cache = cache;
  }

  public State get(String organizationId) {
    Entry cached = readCache(organizationId);
    if (cached != null && !cached.stale()) return cached.state();

    OrganizationStatusResponse response;
    try {
      response = organizations
        .withDeadlineAfter(DEADLINE_SECONDS, TimeUnit.SECONDS)
        .withInterceptors(
          MetadataUtils.newAttachHeadersInterceptor(
            CallerMetadata.of(UNKNOWN_ORIGIN)
          )
        )
        .getOrganizationStatus(
          GetOrganizationStatusRequest.newBuilder()
            .setOrganizationId(organizationId)
            .build()
        );
    } catch (StatusRuntimeException failure) {
      if (cached == null || !unreachable(failure)) throw failure;
      LOG.warn(
        "auth-service unreachable ({}); serving the last known status of {}",
        failure.getStatus().getCode(),
        organizationId
      );

      return cached.state();
    }

    State state = new State(
      nameOf(response.getStatus()),
      response.getDeleted()
    );
    writeCache(organizationId, state);

    return state;
  }

  /**
   * Drops what the gateway caches about a tenant's state at once: this decision and
   * the tenant's cached {@code GET /organizations/current}. Called by every write that
   * changes a status (the platform endpoints, the tenant's own delete and onboarding),
   * so a freeze takes effect on the next request and an outage cannot serve the state
   * from before it. One method, so a write cannot drop one and miss the other.
   * Non-fatal: the entries expire on their own.
   */
  public void invalidate(String organizationId) {
    cache.invalidateScope(organizationId, "organizations");
    try {
      redis.delete(CACHE_PREFIX + organizationId);
    } catch (RuntimeException failure) {
      LOG.warn(
        "Could not invalidate cached status for {}: {}",
        organizationId,
        failure.getMessage()
      );
    }
  }

  /**
   * An UNSPECIFIED (or unrecognised) status means the tenant's state could not be
   * read; FROZEN is the only safe reading.
   */
  static String nameOf(OrgStatus status) {
    return switch (status) {
      case ORG_STATUS_ACTIVE -> "ACTIVE";
      case ORG_STATUS_PENDING_ONBOARDING -> "PENDING_ONBOARDING";
      case ORG_STATUS_SUSPENDED_PAST_DUE -> "SUSPENDED_PAST_DUE";
      default -> "FROZEN";
    };
  }

  private static boolean unreachable(StatusRuntimeException failure) {
    Status.Code code = failure.getStatus().getCode();

    return (
      code == Status.Code.UNAVAILABLE || code == Status.Code.DEADLINE_EXCEEDED
    );
  }

  /** A read failure, or a value not shaped as {@code writeCache} writes it, is a miss and not an error. */
  private Entry readCache(String organizationId) {
    try {
      String raw = redis.opsForValue().get(CACHE_PREFIX + organizationId);
      if (raw == null || raw.isEmpty()) return null;

      JsonNode node = json.readTree(raw);
      JsonNode status = node.get("status");
      JsonNode deleted = node.get("deleted");
      if (status == null || !status.isString() || deleted == null) return null;
      JsonNode freshUntil = node.get("freshUntil");
      boolean stale =
        freshUntil != null && freshUntil.asLong() <= System.currentTimeMillis();

      return new Entry(
        new State(status.asString(), deleted.asBoolean()),
        stale
      );
    } catch (RuntimeException failure) {
      LOG.warn(
        "Status cache unavailable, falling through to auth-service: {}",
        failure.getMessage()
      );

      return null;
    }
  }

  private static java.util.Map<String, Object> valueOf(State state) {
    java.util.Map<String, Object> value = new java.util.LinkedHashMap<>();
    value.put("status", state.status());
    value.put("deleted", state.deleted());
    value.put("freshUntil", System.currentTimeMillis() + TTL.toMillis());

    return value;
  }

  /** Losing the cache costs latency, not correctness, so it must not fail the request. */
  private void writeCache(String organizationId, State state) {
    try {
      redis.opsForValue().set(
        CACHE_PREFIX + organizationId,
        // Ordered `status`, `deleted`, `freshUntil`, as the class doc shows it.
        json.writeValueAsString(valueOf(state)),
        TTL.plus(MAX_STALE)
      );
    } catch (RuntimeException failure) {
      LOG.debug(
        "Could not cache status for {}: {}",
        organizationId,
        failure.getMessage()
      );
    }
  }
}
