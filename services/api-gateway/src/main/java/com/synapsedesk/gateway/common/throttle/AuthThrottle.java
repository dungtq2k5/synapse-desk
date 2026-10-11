package com.synapsedesk.gateway.common.throttle;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a controller or method as security-sensitive — `@AuthThrottle()`,
 * reproduced. {@link ThrottlerInterceptor} evaluates {@code authTier} ONLY
 * for a marked route and skips it entirely for everything else; a route
 * never sees both the strict tier and the general backstop.
 *
 * <p>Class-level covers every handler; method-level marks one.
 *
 * <p><b>A pure marker — no {@code ttlMs}/{@code limit} of its own.</b> A
 * route that needs {@code authTier}'s numbers tightened carries {@link
 * ThrottleOverride} as well (`tier = ThrottlerTiers.AUTH`), the same
 * mechanism {@code medium} and the other general tiers already use.
 * {@link ThrottlerInterceptor#resolveLimit} reads one override mechanism,
 * not two: two spellings of the same per-route number is what let
 * `RouteThrottle`'s login/register/OTP figures sit on this annotation,
 * unread, while every AUTH-tier route silently evaluated the coarse global
 * default instead.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ ElementType.TYPE, ElementType.METHOD })
public @interface AuthThrottle {}
