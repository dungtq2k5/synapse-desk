package com.synapsedesk.gateway.throttle;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Exempts a route from {@link ThrottlerInterceptor} entirely: no tier is
 * evaluated and no counter is written.
 *
 * <p>For a caller that is not a client of this API and retries on its own
 * schedule — a provider's webhook delivery. A 429 there does not slow a burst
 * down; it only delays every event in it until the provider's next retry.
 *
 * <p>A route carrying it must also say {@code @ApiErrors(throttled = false)},
 * so the published document stops listing a 429 the route cannot answer, and
 * only such a route may: {@code SkipThrottleDocumentedTest} holds the two
 * together.
 *
 * <p>Class-level covers every handler; method-level marks one.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ ElementType.TYPE, ElementType.METHOD })
public @interface SkipThrottle {}
