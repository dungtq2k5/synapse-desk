package com.synapsedesk.gateway.inbound;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * What an inbound recipient address resolves to — {@code packages/contracts}'s
 * {@code parseInboundAddress}, behaviour for behaviour.
 *
 * <p>The format is {@code support+{tenant}[.{ticket}]@domain}. The gateway parses
 * it to find the tenant and the thread; notification-service writes it into
 * {@code Reply-To}. Both sides read the same table of examples
 * ({@code address-parity.json}), so mail that routes in one gateway routes in the
 * other.
 *
 * @param tenantToken {@code organizations.inbound_token}: 32 lowercase hex characters
 * @param ticketToken the per-ticket reply token when the sender replied to a
 *     notification, else {@code null}
 */
public record InboundAddress(String tenantToken, String ticketToken) {
  private static final String LOCAL_PART = "support";
  private static final Pattern TOKEN_SEPARATOR = Pattern.compile(
    Pattern.quote(".")
  );
  private static final Pattern TENANT_TOKEN = Pattern.compile("[0-9a-f]{32}");

  /**
   * The address, or {@code null} when nothing could be routed.
   *
   * <p>{@code null} rather than an exception, because an unroutable address is a
   * public address receiving mail nobody could route: it costs a log line.
   *
   * <p>Case is normalised first, so a mail hop that lowercases the local part
   * cannot change the answer. The tenant token is matched in full
   * ({@link java.util.regex.Matcher#matches()}), never with {@code $}, which Java
   * lets match before a trailing line terminator where JavaScript's does not.
   */
  public static InboundAddress parse(String recipient) {
    int at = recipient.lastIndexOf('@');
    String local = JsText.trim(
      at == -1 ? recipient : recipient.substring(0, at)
    ).toLowerCase(Locale.ROOT);

    int plus = local.indexOf('+');
    if (plus == -1) return null;
    if (!local.substring(0, plus).equals(LOCAL_PART)) return null;

    String[] parts = TOKEN_SEPARATOR.split(local.substring(plus + 1), -1);

    // A third segment is not a token this system issued: refused rather than
    // ignored, or several distinct addresses would route to one tenant.
    if (parts.length > 2) return null;
    if (!TENANT_TOKEN.matcher(parts[0]).matches()) return null;

    String ticketToken =
      parts.length > 1 && !parts[1].isEmpty() ? parts[1] : null;

    return new InboundAddress(parts[0], ticketToken);
  }
}
