package com.synapsedesk.gateway.inbound;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * The per-ticket half of a reply address: verifies the token that
 * {@code buildTicketReplyToken} in
 * {@code packages/nest-common/src/configs/inbound-email.config.ts} mints.
 *
 * <p>{@code {base36 ticket number}-{12 hex chars of HMAC-SHA256}}: readable back
 * and unforgeable. The tenant is inside the MAC, so a token minted for one tenant
 * does not verify against another.
 *
 * <p><b>The MAC is exactly 12 ASCII hex digits</b>, in either case: a mail system
 * may change an address's case, never its characters. Anything after them
 * ({@code <mac>zz}, {@code <mac>0}) fails. The table
 * ({@code test/fixtures/inbound-email/address-parity.json}) pins it.
 */
public final class TicketReplyToken {

  private static final int MAC_CHARS = 12;
  private static final Pattern MAC_HEX = Pattern.compile(
    "[0-9a-fA-F]{" + MAC_CHARS + "}"
  );
  private static final Pattern SEPARATOR = Pattern.compile(Pattern.quote("-"));
  /** {@code Number.MAX_SAFE_INTEGER}: above it a JavaScript number is not exact. */
  private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

  private TicketReplyToken() {}

  /**
   * The ticket number the token attests to, or {@code null} for every failure —
   * malformed, wrong tenant, altered number, altered MAC. The caller treats all of
   * them alike: open a NEW ticket, because a duplicate is visible and annoying
   * where threading a stranger's mail onto somebody's conversation is a disclosure.
   */
  public static Long parse(String token, String organizationId, String secret) {
    String[] parts = SEPARATOR.split(token, -1);
    if (parts.length != 2 || parts[0].isEmpty() || parts[1].isEmpty()) {
      return null;
    }

    long ticketNumber;
    try {
      ticketNumber = Long.parseLong(parts[0], 36);
    } catch (NumberFormatException notBase36) {
      return null;
    }
    if (ticketNumber <= 0 || ticketNumber > MAX_SAFE_INTEGER) return null;
    // Round-trip: the parse stops being strict about a sign, a case or a leading
    // zero, and `12x` must not become 12 and verify against a MAC never issued.
    if (!Long.toString(ticketNumber, 36).equals(parts[0])) return null;

    if (!MAC_HEX.matcher(parts[1]).matches()) return null;
    byte[] given = HexFormat.of().parseHex(parts[1]);
    byte[] want = HexFormat.of().parseHex(
      mac(organizationId, ticketNumber, secret)
    );

    return MessageDigest.isEqual(given, want) ? ticketNumber : null;
  }

  private static String mac(
    String organizationId,
    long ticketNumber,
    String secret
  ) {
    try {
      Mac hmac = Mac.getInstance("HmacSHA256");
      hmac.init(
        new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256")
      );
      byte[] digest = hmac.doFinal(
        (organizationId + ":" + ticketNumber).getBytes(StandardCharsets.UTF_8)
      );

      return HexFormat.of().formatHex(digest).substring(0, MAC_CHARS);
    } catch (NoSuchAlgorithmException | InvalidKeyException failure) {
      throw new IllegalStateException("HmacSHA256 is not available", failure);
    }
  }
}
