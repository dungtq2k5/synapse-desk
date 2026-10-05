package com.synapsedesk.gateway.config;

import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * `Date.prototype.toISOString()`, exactly: always 3 fractional digits, always
 * `Z`. {@link java.time.Instant#toString()} drops trailing zero millis and
 * cannot be used here — the wire bytes must match Node's, not merely parse.
 *
 * <p>
 * Shared by {@link com.synapsedesk.gateway.cache.CacheService}'s tagged-date
 * encoding and the GraphQL `DateTime` scalar, so the two never drift apart the
 * way a second hand-written formatter could.
 */
public final class JsIsoFormat {

  public static final DateTimeFormatter PATTERN = DateTimeFormatter.ofPattern(
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
  ).withZone(ZoneOffset.UTC);

  private JsIsoFormat() {}
}
