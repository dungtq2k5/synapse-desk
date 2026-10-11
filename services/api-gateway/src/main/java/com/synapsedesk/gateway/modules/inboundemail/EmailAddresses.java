package com.synapsedesk.gateway.modules.inboundemail;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pulling one part out of an address a human typed — the shared library's
 * {@code extractEmailAddress} and {@code extractEmailDomain}.
 *
 * <p>Lower-cased, because comparison is the point: a display name is decoration
 * the sender controls, so a guard comparing whole headers would miss
 * {@code "SynapseDesk Support" <support@…>} and fail OPEN into the self-loop it
 * exists to stop.
 */
final class EmailAddresses {

  private static final Pattern ANGLED = Pattern.compile("<([^>]+)>");

  private EmailAddresses() {}

  /** {@code Name <addr>} → {@code addr}, trimmed and lower-cased; a bare value is itself. */
  static String extractEmailAddress(String value) {
    Matcher angled = ANGLED.matcher(value);
    String address = angled.find() ? angled.group(1) : value;

    return JsText.trim(address).toLowerCase(Locale.ROOT);
  }

  /** The SECOND {@code @}-separated segment, as the shared library takes it — or {@code null}. */
  static String extractEmailDomain(String email) {
    if (email == null || email.isEmpty()) return null;

    String[] parts = email.split("@", -1);
    String domain = parts.length > 1 ? parts[1] : null;

    return domain == null || domain.isEmpty() ? null : domain;
  }
}
