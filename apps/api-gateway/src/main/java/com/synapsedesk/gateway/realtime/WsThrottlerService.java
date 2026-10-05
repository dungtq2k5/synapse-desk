package com.synapsedesk.gateway.realtime;

import com.synapsedesk.gateway.config.ThrottleProperties;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * `WsThrottlerService`, reproduced — with ONE deliberate deviation in the
 * handshake key, decided on its merits rather than assumed.
 *
 * <p><b>The handshake key is per-implementation, not shared.</b> Node's key
 * is {@code ws_handshake:${gatewayName}:${ip}}, where {@code gatewayName} is
 * {@code RealtimeGateway.name} — a CLASS NAME, resolved at runtime, with no
 * compiler or test connecting it to anything on the Java side. Matching it
 * byte-for-byte would mean freezing a Java class's name to a Node class's
 * name; a rename on either side would silently split the budget into two
 * rather than fail. So this gateway's own identity, {@link #GATEWAY_IDENTITY},
 * is a literal wire-key constant, not a reflected class name, and the two
 * implementations keep SEPARATE handshake budgets — accepted for the same
 * reason gap 40 accepts a per-implementation cache: the budget resets once,
 * at a cutover, a deliberate and rare event.
 *
 * <p>{@code ws_event:{event}:{subject}} has no such problem — `event` and
 * `subject` are already contract strings (an event name, a verified JWT
 * `sub`) — so it is SHARED, unchanged from Node's exact format.
 *
 * <p>Algorithm: the same {@code INCR} + one-time {@code EXPIRE} pattern
 * {@code ThrottlerInterceptor} already uses for HTTP, not a Lua script —
 * gap 41 closes on KEY-format parity, not algorithmic parity. Fails OPEN on
 * any Redis error, exactly like every other Redis-backed class here.
 */
@Component
public class WsThrottlerService {

  private static final Logger LOG = LoggerFactory.getLogger(
    WsThrottlerService.class
  );

  /** This implementation's own wire identity — never Node's class name. */
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
