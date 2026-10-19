package com.synapsedesk.gateway.modules.realtime;

import com.synapsedesk.gateway.common.config.JsIsoFormat;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * `PresenceService`, reproduced — one expiring Redis key per user,
 * `presence:{org}:{user}`, string-format parity only. Three properties this
 * shape answers at once: one user can hold many sockets (a key per USER, not
 * per socket), many gateway instances share it (Redis, not process memory),
 * and an explicit state beats an inferred one (a new connection never resets
 * an existing `busy`).
 *
 * <p><b>No `onDisconnect`, deliberately.</b> Clearing the key on socket close
 * would take a user offline the moment they close ONE of three tabs; the 60s
 * TTL is the entire crash-recovery story — the absence of a heartbeat IS the
 * offline signal, needing no reaper.
 */
@Component
public class PresenceService {

  private static final Logger LOG = LoggerFactory.getLogger(
    PresenceService.class
  );

  private static final Duration TTL = Duration.ofSeconds(60);
  private static final String ONLINE = "online";
  private static final Set<String> STATES = Set.of(
    ONLINE,
    "away",
    "busy",
    "offline"
  );

  private final StringRedisTemplate redis;
  private final ObjectMapper json;

  public PresenceService(StringRedisTemplate redis, ObjectMapper json) {
    this.redis = redis;
    this.json = json;
  }

  /** What {@link #set} reports: whether the STATE actually changed. */
  public record Update(boolean changed, String state) {}

  /**
   * A socket connected. `online` ONLY if nothing is recorded — an existing
   * `busy` survives a new tab. Returns `online` when this connection set it,
   * the one transition a connect makes, and {@code null} otherwise: something
   * was already recorded, or the store was unreachable. A transition not
   * actually made must not be announced, and a state read beforehand can be
   * stale by the time this runs (another socket's update in between).
   */
  public String onConnect(String organizationId, String userId) {
    String key = key(organizationId, userId);

    try {
      Boolean written = redis
        .opsForValue()
        .setIfAbsent(key, encode(ONLINE), TTL);
      if (Boolean.TRUE.equals(written)) {
        return ONLINE;
      }

      // Something was already there — refresh its TTL without touching its
      // value, so an existing `busy` survives the new tab AND stays alive.
      redis.expire(key, TTL);

      return null;
    } catch (RuntimeException failure) {
      LOG.error("Presence connect failed: {}", failure.getMessage());

      return null;
    }
  }

  /**
   * An explicit {@code presence:update}. Last write wins, with no merge —
   * this is the only writer of an explicit state, so "wins" just means "the
   * user's most recent statement about themselves."
   */
  public Update set(String organizationId, String userId, String state) {
    try {
      String previous = read(organizationId, userId);
      redis.opsForValue().set(key(organizationId, userId), encode(state), TTL);

      return new Update(!Objects.equals(previous, state), state);
    } catch (RuntimeException failure) {
      LOG.error("Presence write failed: {}", failure.getMessage());
      // Reported as unchanged, so a store outage produces silence rather
      // than a storm of transitions nobody can trust.
      return new Update(false, state);
    }
  }

  /** The state on record, or {@code null} if expired, absent, or malformed. */
  public String read(String organizationId, String userId) {
    String raw = redis.opsForValue().get(key(organizationId, userId));
    if (raw == null) {
      return null;
    }

    try {
      JsonNode presenceNode = json.readTree(raw);
      JsonNode state = presenceNode.get("state");
      String value =
        state != null && state.isString() ? state.asString() : null;

      return STATES.contains(value) ? value : null;
    } catch (RuntimeException malformed) {
      // A malformed value is treated as absent rather than crashing the
      // read. The key expires within a minute regardless.
      return null;
    }
  }

  private static String key(String organizationId, String userId) {
    return "presence:" + organizationId + ":" + userId;
  }

  private String encode(String state) {
    return json
      .createObjectNode()
      .put("state", state)
      .put("updatedAt", JsIsoFormat.PATTERN.format(Instant.now()))
      .toString();
  }
}
