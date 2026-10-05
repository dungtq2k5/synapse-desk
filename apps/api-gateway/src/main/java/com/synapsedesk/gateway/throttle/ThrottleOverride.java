package com.synapsedesk.gateway.throttle;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Replaces one tier's numbers for this route only — `@Throttle({[tier]:
 * {ttl, limit}})`, reproduced. {@code tier} must be a tier this route
 * actually evaluates ({@link ThrottlerTiers#AUTH} on an {@link AuthThrottle}
 * route, one of {@link ThrottlerTiers#GENERAL} otherwise) — {@code
 * ThrottleOverrideTest} pins every current use against `throttler.config.ts`'s
 * {@code ROUTE_THROTTLE} table.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ThrottleOverride {
  String tier();

  long ttlMs();

  int limit();
}
