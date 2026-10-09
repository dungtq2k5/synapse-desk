package com.synapsedesk.gateway.realtime;

import com.synapsedesk.gateway.config.ThrottleProperties;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Per-IP handshake and per-user event budgets for the realtime socket, kept
 * in Redis.
 *
 * <p><b>The handshake key</b> is {@code ws_handshake:${identity}:${ip}}, where
 * the identity is {@link #GATEWAY_IDENTITY} — a literal wire-key constant,
 * not a reflected class name, so renaming the class cannot silently move
 * every budget to a new key.
 *
 * <p>{@code ws_event:{event}:{subject}} is built from contract strings only
 * (an event name, a verified JWT `sub`).
 *
 * <p>Algorithm: the same {@code INCR} + one-time {@code EXPIRE} pattern
 * {@code ThrottlerInterceptor} already uses for HTTP, not a Lua script. Fails
 * OPEN on any Redis error, exactly like every other Redis-backed class here.
 */
@Component
public class WsThrottlerService {

  private static final Logger LOG = LoggerFactory.getLogger(
    WsThrottlerService.class
  );

  /** This gateway's wire identity in the handshake key — never a class name. */
  private static final String GATEWAY_IDENTITY = "java-realtime-gateway";

  private final StringRedisTemplate redis;
  private final ThrottleProperties throttle;

  public WsThrottlerService(
    StringRedisTemplate redis,
    ThrottleProperties throttle
  ) {
    this.redis = redis;
    this.throttle = throttle;
  }

  /**
   * The handshake budget: sheds past the limit, and never blocks. A refused
   * handshake retries on the client's own backoff and succeeds once the window
   * moves on. A block would turn a burst into a guaranteed outage: a switch drops
   * every socket at once, and an office behind one NAT reconnects together.
   */
  public boolean allowHandshake(String ip) {
    String key = "ws_handshake:" + GATEWAY_IDENTITY + ":" + ip;

    return allow(key, throttle.wsHandshakeTtl(), throttle.wsHandshakeLimit());
  }

  /** The per-event budget: sheds past the limit like the handshake; exceeding it is normal. */
  public boolean allowEvent(String event, String subject) {
    WsEventLimits.Limit limit = WsEventLimits.of(event);
    String key = "ws_event:" + event + ":" + subject;

    return allow(key, limit.ttlMs(), limit.count());
  }

  private boolean allow(String key, long ttlMs, int limit) {
    try {
      long count = redis.opsForValue().increment(key);
      if (count == 1) {
        redis.expire(key, Duration.ofMillis(ttlMs));
      }

      return count <= limit;
    } catch (RuntimeException redisFailure) {
      LOG.error(
        "WS rate-limit storage unavailable; allowing unthrottled: {}",
        redisFailure.getMessage()
      );

      return true;
    }
  }
}
