package com.synapsedesk.gateway.common.throttle;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Replaces one tier's numbers for this route only, e.g. {@code
 * @ThrottleOverride(tier = ThrottlerTiers.AUTH, ttlMs =
 * RouteThrottle.LOGIN_TTL_MS, limit = RouteThrottle.LOGIN_LIMIT)}. {@code tier}
 * must be a tier this route actually evaluates ({@link ThrottlerTiers#AUTH} on
 * an {@link AuthThrottle} route, one of {@link ThrottlerTiers#GENERAL}
 * otherwise); the numbers come from {@link RouteThrottle}.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ThrottleOverride {
  String tier();

  long ttlMs();

  int limit();
}
