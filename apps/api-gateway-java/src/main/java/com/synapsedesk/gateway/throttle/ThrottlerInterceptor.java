package com.synapsedesk.gateway.throttle;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.config.ThrottleProperties;
import com.synapsedesk.gateway.web.CachedBodyRequest;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * `SmartThrottlerGuard`, reproduced — routes to ONE tier set, never all four.
 *
 * <p>A route carrying {@link AuthThrottle} (method wins over class) evaluates
 * {@link ThrottlerTiers#AUTH} only; every other route evaluates {@link
 * ThrottlerTiers#GENERAL} only. Evaluating both would be wrong in both
 * directions — a login also governed by the loose general tiers, or every
 * ordinary read counted against the strict auth budget — which is Node's own
 * reasoning, reproduced rather than re-derived.
 *
 * <p><b>Fails OPEN, loudly.</b> Any Redis failure is caught, logged at ERROR,
 * and the request proceeds unthrottled for that tier — a Redis outage must
 * make rate limiting absent, not turn every route into a 500. {@code
 * ponytail:} the counter itself is a plain {@code INCR} + one-time {@code
 * EXPIRE}, not a Lua script — the race (a crash between the two leaves a
 * key with no TTL) is the same shape {@code @nestjs/throttler}'s own Redis
 * adapter accepts; a script closes it if it's ever measured to matter.
 */
@Component
public class ThrottlerInterceptor implements HandlerInterceptor {

  private static final Logger log = LoggerFactory.getLogger(ThrottlerInterceptor.class);

  private final StringRedisTemplate redis;
  private final ThrottleProperties throttle;
  private final CurrentUser currentUser;
  private final ObjectMapper json;

  public ThrottlerInterceptor(
      StringRedisTemplate redis, ThrottleProperties throttle, CurrentUser currentUser, ObjectMapper json) {
    this.redis = redis;
    this.throttle = throttle;
    this.currentUser = currentUser;
    this.json = json;
  }

  // FIXME Refactor this method to not always return the same value. [+2 locations]
  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    if (!(handler instanceof HandlerMethod handlerMethod)) {
      return true;
    }

    List<String> tiers = hasAuthThrottle(handlerMethod) ? List.of(ThrottlerTiers.AUTH) : ThrottlerTiers.GENERAL;
    String tracker = tracker(request);
    String route = handlerMethod.getBeanType().getSimpleName() + "." + handlerMethod.getMethod().getName();

    for (String tier : tiers) {
      evaluate(handlerMethod, tier, route, tracker, request, response);
    }

    return true;
  }

  private void evaluate(
      HandlerMethod handlerMethod,
      String tier,
      String route,
      String tracker,
      // FIXME Remove this unused method parameter "request".
      HttpServletRequest request,
      HttpServletResponse response) {
    TierLimit limit = resolveLimit(handlerMethod, tier);
    String key = "throttle:" + route + ":" + tier + ":" + tracker;

    long count;
    try {
      count = redis.opsForValue().increment(key);
      if (count == 1) {
        redis.expire(key, Duration.ofMillis(limit.ttlMs()));
      }
    } catch (RuntimeException redisFailure) {
      log.error(
          "Rate-limit storage unavailable; allowing request unthrottled: {}", redisFailure.getMessage());

      return;
    }

    long resetSeconds = remainingTtlSeconds(key, limit.ttlMs());

    if (count > limit.limit()) {
      response.setHeader("Retry-After", String.valueOf(resetSeconds));
      response.setHeader("Retry-After-" + tier, String.valueOf(resetSeconds));

      throw new ResponseStatusException(
          HttpStatus.TOO_MANY_REQUESTS,
          "Too many requests. Try again in " + describeWait(resetSeconds) + ".");
    }

    response.setHeader("X-RateLimit-Limit-" + tier, String.valueOf(limit.limit()));
    response.setHeader("X-RateLimit-Remaining-" + tier, String.valueOf(Math.max(0, limit.limit() - count)));
    response.setHeader("X-RateLimit-Reset-" + tier, String.valueOf(resetSeconds));
  }

  private long remainingTtlSeconds(String key, long ttlMs) {
    Long ttl = redis.getExpire(key, TimeUnit.SECONDS);

    return (ttl == null || ttl < 0) ? Math.max(1, ttlMs / 1000) : ttl;
  }

  private TierLimit resolveLimit(HandlerMethod handlerMethod, String tier) {
    ThrottleOverride override = handlerMethod.getMethodAnnotation(ThrottleOverride.class);
    if (override != null && override.tier().equals(tier)) {
      return new TierLimit(override.ttlMs(), override.limit());
    }

    return switch (tier) {
      case ThrottlerTiers.SHORT -> new TierLimit(throttle.shortTtl(), throttle.shortLimit());
      case ThrottlerTiers.MEDIUM -> new TierLimit(throttle.mediumTtl(), throttle.mediumLimit());
      case ThrottlerTiers.LONG -> new TierLimit(throttle.longTtl(), throttle.longLimit());
      case ThrottlerTiers.AUTH -> new TierLimit(throttle.authTtl(), throttle.authLimit());
      default -> throw new IllegalStateException("Unknown tier: " + tier);
    };
  }

  private static boolean hasAuthThrottle(HandlerMethod handlerMethod) {
    return handlerMethod.getMethodAnnotation(AuthThrottle.class) != null
        || handlerMethod.getBeanType().getAnnotation(AuthThrottle.class) != null;
  }

  /**
   * `getTracker`, reproduced: `user:<sub>` for a VERIFIED token (full session
   * or not — {@link CurrentUser#verifiedSubject} matches
   * `subjectFromToken`'s own scope), else `ip:<ip>` or
   * `ip:<ip>|acct:<email>`.
   */
  private String tracker(HttpServletRequest request) {
    Optional<String> sub = currentUser.verifiedSubject(request);
    if (sub.isPresent()) {
      return "user:" + sub.get();
    }

    String ip = clientIp(request);
    String account = accountIdentifier(request);

    return account != null ? "ip:" + ip + "|acct:" + account : "ip:" + ip;
  }

  /**
   * The rightmost {@code X-Forwarded-For} entry — Express's own {@code trust
   * proxy 1} semantics (P6): exactly one hop is trusted, and it is the one
   * that appended the LAST entry. Spring's {@code ForwardedHeaderFilter}
   * default (leftmost) is client-supplied and spoofable — see plan 86 §6.
   * Scoped to the throttler's tracker only; {@code CurrentUser.origin()}'s
   * {@code getRemoteAddr()} stays as plan 83 left it, since audit metadata
   * never keyed a bucket.
   */
  private static String clientIp(HttpServletRequest request) {
    String forwardedFor = request.getHeader("X-Forwarded-For");
    if (forwardedFor == null || forwardedFor.isBlank()) {
      return request.getRemoteAddr();
    }

    String[] hops = forwardedFor.split(",");

    return hops[hops.length - 1].trim();
  }

  /** The `email` field of a JSON body, lower-cased — `extractAccountIdentifier`, reproduced. */
  private String accountIdentifier(HttpServletRequest request) {
    if (!(request instanceof CachedBodyRequest cached)) {
      return null;
    }

    try {
      JsonNode node = json.readTree(cached.body());
      JsonNode email = node.get("email");

      return email != null && email.isString() && !email.asString().isEmpty()
          ? email.asString().trim().toLowerCase()
          : null;
    } catch (RuntimeException malformed) {
      return null;
    }
  }

  /** "45 seconds" / "15 minutes" — `describeWait`, reproduced. */
  private static String describeWait(long seconds) {
    if (seconds < 60) {
      return seconds + " second" + (seconds == 1 ? "" : "s");
    }

    long minutes = (long) Math.ceil(seconds / 60.0);

    return minutes + " minute" + (minutes == 1 ? "" : "s");
  }

  private record TierLimit(long ttlMs, int limit) {}
}
