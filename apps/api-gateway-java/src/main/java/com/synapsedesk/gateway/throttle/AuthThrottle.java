package com.synapsedesk.gateway.throttle;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a controller or method as security-sensitive — `@AuthThrottle()`,
 * reproduced. {@link SmartThrottlerInterceptor} evaluates {@code authTier}
 * ONLY for a marked route and skips it entirely for everything else; a route
 * never sees both the strict tier and the general backstop.
 *
 * <p>Class-level covers every handler; method-level marks one. An explicit
 * {@link #ttlMs()}/{@link #limit()} overrides {@code authTier}'s configured
 * default for that one route — {@code ROUTE_THROTTLE}'s per-route entries,
 * reproduced as annotation arguments since Java annotations need compile-time
 * constants rather than a runtime-keyed map.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface AuthThrottle {

  /** -1 means "use {@code authTier}'s configured default". */
  long ttlMs() default -1;

  /** -1 means "use {@code authTier}'s configured default". */
  int limit() default -1;
}
