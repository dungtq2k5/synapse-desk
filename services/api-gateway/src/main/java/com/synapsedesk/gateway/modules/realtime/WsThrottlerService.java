package com.synapsedesk.gateway.modules.realtime;

import com.synapsedesk.gateway.common.config.ThrottleProperties;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * The socket handshake's limits, in layers, each keyed on the best thing known at
 * its stage, and the per-event limit, kept in Redis.
 *
 * <ul>
 *   <li><b>Flood ceiling</b>, before the token is checked: the client IP ({@code
 *       ws_handshake:flood:<ip>}).
 *   <li><b>Failed handshakes</b>: the client IP ({@code ws_handshake:failed:<ip>}),
 *       charged only by a handshake with no verified identity, after the token is
 *       checked.
 *   <li><b>Per user</b>: the verified {@code sub} ({@code ws_handshake:user:<sub>}),
 *       an expired or revoked token's included.
 *   <li><b>Events</b>: {@code ws_event:<event>:<sub>}.
 * </ul>
 *
 * <p>Each key is counted by {@link #COUNT}, which starts its window on the first hit
 * in the same step, so a key can never be left without an expiry. The keys carry no
 * gateway name, so a client has one budget whichever gateway it reaches. Past a limit the handshake is shed, never blocked. Fails OPEN
 * on any Redis error, loudly.
 */
@Component
public class WsThrottlerService {

  private static final Logger LOG = LoggerFactory.getLogger(
    WsThrottlerService.class
  );

  /** {@code INCR}, and {@code PEXPIRE} on the first hit, atomically. */
  static final RedisScript<Long> COUNT = new DefaultRedisScript<>(
    "local n = redis.call('INCR', KEYS[1])\n" +
      "if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end\n" +
      "return n",
    Long.class
  );

  private final StringRedisTemplate redis;
  private final ThrottleProperties throttle;

  public WsThrottlerService(
    StringRedisTemplate redis,
    ThrottleProperties throttle
  ) {
    this.redis = redis;
    this.throttle = throttle;
  }

  /** Counts a handshake from {@code ip} against the flood ceiling. */
  public boolean allowHandshake(String ip) {
    return allow(
      "ws_handshake:flood:" + ip,
      throttle.wsHandshakeTtl(),
      throttle.wsHandshakeLimit()
    );
  }

  /** Counts a handshake with no verified identity; false once {@code ip} is past the limit. */
  public boolean allowFailed(String ip) {
    return allow(
      "ws_handshake:failed:" + ip,
      throttle.wsHandshakeFailedTtl(),
      throttle.wsHandshakeFailedLimit()
    );
  }

  /** Counts a handshake whose signature verified against its user. */
  public boolean allowUser(String sub) {
    return allow(
      "ws_handshake:user:" + sub,
      throttle.wsHandshakeUserTtl(),
      throttle.wsHandshakeUserLimit()
    );
  }

  /** Counts an event from a verified user. */
  public boolean allowEvent(String event, String subject) {
    WsEventLimits.Limit limit = WsEventLimits.of(event);
    return allow(
      "ws_event:" + event + ":" + subject,
      limit.ttlMs(),
      limit.count()
    );
  }

  private boolean allow(String key, long ttlMs, int limit) {
    try {
      Long hits = redis.execute(COUNT, List.of(key), String.valueOf(ttlMs));
      if (hits == null) throw new IllegalStateException(
        "Redis returned no count"
      );
      return hits <= limit;
    } catch (RuntimeException redisFailure) {
      LOG.error(
        "WS rate-limit storage unavailable; allowing unthrottled: {}",
        redisFailure.getMessage()
      );
      return true;
    }
  }
}
