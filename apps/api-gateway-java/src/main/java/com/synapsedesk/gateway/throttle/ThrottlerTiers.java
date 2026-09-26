package com.synapsedesk.gateway.throttle;

import java.util.List;

/**
 * The four tier names — `throttler.config.ts`'s constants, reproduced.
 *
 * <p>The names are load-bearing, not labels: {@link ThrottlerInterceptor}
 * routes by comparing against them exactly, and {@code CorsHeaders} derives
 * the exposed-header list from the same four strings, so a rename here is a
 * single edit rather than a place the two can drift.
 */
public final class ThrottlerTiers {

  private ThrottlerTiers() {}

  public static final String SHORT = "short";
  public static final String MEDIUM = "medium";
  public static final String LONG = "long";

  /** The strict tier — routes marked {@link AuthThrottle} see this and nothing else. */
  public static final String AUTH = "authTier";

  /** The blunt backstop every other route sees, in registration order. */
  public static final List<String> GENERAL = List.of(SHORT, MEDIUM, LONG);

  /** Every tier, in the order the throttler module registers them. */
  public static final List<String> ALL = List.of(SHORT, MEDIUM, LONG, AUTH);
}
