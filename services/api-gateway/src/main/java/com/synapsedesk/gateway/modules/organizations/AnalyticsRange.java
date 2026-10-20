package com.synapsedesk.gateway.modules.organizations;

/**
 * The longest analytics range one request may span: the plan's grant held to
 * the platform's limit, as {@code resolveAnalyticsRangeDays} in
 * {@code @synapsedesk/contracts} composes it for the services that refuse.
 */
public final class AnalyticsRange {

  /** The platform's limit, {@code MAX_ANALYTICS_RANGE_DAYS}. */
  public static final int MAX_DAYS = 400;

  private AnalyticsRange() {}

  /** @return the smaller of the grant and the platform's limit. */
  public static int resolve(int granted) {
    return Math.min(MAX_DAYS, granted);
  }
}
