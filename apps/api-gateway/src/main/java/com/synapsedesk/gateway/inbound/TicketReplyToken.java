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
 * The per-ticket half of a reply address — {@code libs/common}'s
 * {@code parseTicketReplyToken}, behaviour for behaviour.
 *
 * <p>{@code {base36 ticket number}-{12 hex chars of HMAC-SHA256}}: readable back
 * and unforgeable. The tenant is inside the MAC, so a token minted for one tenant
 * does not verify against another.
 *
 * <p><b>Reproduced as it is, quirks included.</b> The MAC is decoded the way
 * Node's {@code Buffer.from(mac, 'hex')} decodes it: up to the first character
 * that is not hex, an odd trailing digit dropped. So {@code <mac>zz} and
 * {@code <mac>0} verify here exactly as they do there. It forges nothing — the
 * leading 12 digits must still be the right MAC — and holding both gateways to
 * one answer matters more than being stricter in one of them. The shared table
 * ({@code address-parity.json}) pins it.
 */
public final class TicketReplyToken {

  private static final int MAC_CHARS = 12;
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

    byte[] given = leadingHexBytes(parts[1]);
    byte[] want = HexFormat.of().parseHex(
      mac(organizationId, ticketNumber, secret)
    );
    if (given.length != want.length || given.length == 0) return null;

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

  /** Node's lenient hex decode: whole byte pairs, stopping at the first non-hex one. */
  private static byte[] leadingHexBytes(String hex) {
    byte[] bytes = new byte[hex.length() / 2];
    int count = 0;
    while (count < bytes.length) {
      int high = Character.digit(hex.charAt(2 * count), 16);
      int low = Character.digit(hex.charAt(2 * count + 1), 16);
      if (high < 0 || low < 0 || !isAsciiHex(hex, 2 * count)) break;
      bytes[count++] = (byte) ((high << 4) | low);
    }

    return java.util.Arrays.copyOf(bytes, count);
  }

  /**
   * {@link Character#digit} also accepts non-ASCII digits (Arabic-Indic and the
   * like); Node's decoder does not.
   */
  private static boolean isAsciiHex(String hex, int index) {
    for (int i = index; i < index + 2; i++) {
      char c = hex.charAt(i);
      boolean ascii =
        (c >= '0' && c <= '9') ||
        (c >= 'a' && c <= 'f') ||
        (c >= 'A' && c <= 'F');
      if (!ascii) return false;
    }

    return true;
  }
}
