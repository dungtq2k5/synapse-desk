package com.synapsedesk.gateway.lifecycle;

import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.grpc.CallerMetadata;
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
 * The tenant lifecycle state, cached — Node's {@code OrganizationStatusService}.
 *
 * <p>Sits in front of a gRPC call because the gate runs on essentially every
 * authenticated request: uncached it would double the gateway's chattiness with
 * auth-service for a value that changes a handful of times in a tenant's life.
 *
 * <p><b>Shared with Node, not a copy of its idea.</b> The decision is cached in
 * Redis under {@code org-status:<id>} as {@code {"status":"ACTIVE","deleted":false}}
 * for thirty seconds, exactly as Node writes it, so whichever gateway asks next
 * reads what the other cached. In Redis rather than a map in this process for the
 * same reason the throttler is: a freeze must take effect across every replica, not
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
 * but correct, not a 500 on every authenticated request. A peer that cannot be
 * reached DOES fail the request: it is not waved through.
 */
@Service
public class OrganizationStatusService {

  private static final Logger LOG = LoggerFactory.getLogger(
    OrganizationStatusService.class
  );

  /** {@code STATUS_CACHE_TTL_SECONDS}. */
  static final Duration TTL = Duration.ofSeconds(30);

  static final String CACHE_PREFIX = "org-status:";

  private static final long DEADLINE_SECONDS = 5;

  /** The RPC is by id and unscoped: no user and no tenant travel with it. */
  private static final RequestOrigin UNKNOWN_ORIGIN = new RequestOrigin("", "");

  /**
   * What the gate needs to decide, and nothing else.
   *
   * @param status the lifecycle state, spelled as Node spells it
   * @param deleted true once offboarded: distinct from any status, so a deleted
   *     tenant is refused even while its status still reads ACTIVE
   */
  public record State(String status, boolean deleted) {}

  private final OrganizationServiceBlockingStub organizations;
  private final StringRedisTemplate redis;
  private final ObjectMapper json;

  public OrganizationStatusService(
    OrganizationServiceBlockingStub organizations,
    StringRedisTemplate redis,
    ObjectMapper json
  ) {
    this.organizations = organizations;
    this.redis = redis;
    this.json = json;
  }

  public State get(String organizationId) {
    State cached = readCache(organizationId);
    if (cached != null) return cached;

    OrganizationStatusResponse response = organizations
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

    State state = new State(
      nameOf(response.getStatus()),
      response.getDeleted()
    );
    writeCache(organizationId, state);

    return state;
  }

  /**
   * Drops the cached decision immediately — called by the platform endpoints that
   * change a tenant's status. Without it a freeze would not take effect for up to
   * the thirty seconds, which is the wrong direction for the one action an operator
   * takes when something is going wrong right now. Non-fatal: the entry expires on
   * its own.
   */
  public void invalidate(String organizationId) {
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

  /** A read failure, or a value that is not the shape Node writes, is a miss and not an error. */
  private State readCache(String organizationId) {
    try {
      String raw = redis.opsForValue().get(CACHE_PREFIX + organizationId);
      if (raw == null || raw.isEmpty()) return null;

      JsonNode node = json.readTree(raw);
      JsonNode status = node.get("status");
      JsonNode deleted = node.get("deleted");
      if (status == null || !status.isString() || deleted == null) return null;

      return new State(status.asString(), deleted.asBoolean());
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

    return value;
  }

  /** Losing the cache costs latency, not correctness, so it must not fail the request. */
  private void writeCache(String organizationId, State state) {
    try {
      redis.opsForValue().set(
        CACHE_PREFIX + organizationId,
        // Ordered as Node writes it: `status`, then `deleted`.
        json.writeValueAsString(valueOf(state)),
        TTL
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
