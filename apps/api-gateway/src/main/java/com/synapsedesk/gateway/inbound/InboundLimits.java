package com.synapsedesk.gateway.inbound;

import java.util.Set;

/**
 * The bounds and allowlist the inbound-email path validates against.
 *
 * <p><b>A second copy, held to the first by a guard.</b> The attachment
 * allowlist and bounds are {@code libs/common}'s attachment vocabulary, which the
 * generated Java vocabulary does not carry (it renders string maps); the other
 * bounds are this gateway's own. So they are written here, and
 * {@code scripts/lib/inbound-limits.spec.ts} fails when either side changes —
 * every integer here equals its {@code libs/common} counterpart or is listed as
 * gateway-owned, and the allowlist is compared as a set in both directions, so
 * an added type or a moved bound cannot pass unnoticed.
 */
public final class InboundLimits {

  /** {@code ALLOWED_ATTACHMENT_MIME_TYPES}, platform policy decided once at the edge. */
  public static final Set<String> ALLOWED_ATTACHMENT_MIME_TYPES = Set.of(
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  public static final int MAX_ATTACHMENT_FILE_NAME_LENGTH = 255;
  public static final int MAX_ATTACHMENTS_PER_MESSAGE = 5;

  /** {@code MAX_ATTACHMENT_BYTES}: the platform ceiling, 10 MiB, before a plan or tenant narrows it. */
  public static final int MAX_ATTACHMENT_BYTES = 10485760;

  /** {@code INGEST_DEADLINE_MS}: ticket-service's own deadline on a fetch; the gateway allows five seconds more. */
  public static final int INGEST_DEADLINE_MS = 30000;
  public static final int MAX_OBJECT_PATH_LENGTH = 1024;

  public static final int MAX_PRESENTED_ATTACHMENTS = 20;
  public static final int MAX_MESSAGE_ID_LENGTH = 255;
  public static final int MAX_EMAIL_ADDRESS_LENGTH = 320;
  public static final int MAX_FULL_NAME_LENGTH = 150;
  public static final int MAX_HEADER_LINE_LENGTH = 998;
  public static final int MAX_DATE_HEADER_LENGTH = 255;

  /**
   * {@code MAX_INBOUND_BODY_LENGTH}: the longest body, in UTF-16 code units, that
   * is read at all; the rest is cut off where the mail enters, before anything
   * scans it.
   *
   * <p>As regular expressions, the patterns that strip quoted history and HTML
   * rescan to the end of the input from every unterminated opener, so a body of
   * unclosed tags costs time proportional to the SQUARE of its length (4.3 s at
   * 50 000 and about ten minutes at 800 000 in Java's engine). Here they are
   * scanners ({@link HtmlScan}) and linear. Measured on the worst shape ({@code
   * <div } repeated, no {@code >}), through {@code toStoredBody}:
   *
   * <table>
   *   <caption>Worst-case time by length</caption>
   *   <tr><th>Length</th><th>Scanners</th></tr>
   *   <tr><td>20 000</td><td>under 10 ms</td></tr>
   *   <tr><td>50 000</td><td>~10 ms</td></tr>
   *   <tr><td>100 000</td><td>~15 ms</td></tr>
   *   <tr><td>800 000</td><td>~90 ms</td></tr>
   * </table>
   *
   * <p><b>Why not lower.</b> HTML from some clients carries a large {@code <style>}
   * head before the message, and a cut that lands before the message loses what the
   * customer wrote.
   *
   * <p>Truncated, not rejected: a long forwarded thread is a legitimate mail, and
   * what was written last is at the top. Counted in code units because that is
   * {@code String.length}.
   */
  public static final int MAX_INBOUND_BODY_LENGTH = 50000;

  /** RFC 5322 {@code msg-id} characters: printable ASCII, no space. */
  public static final String PRINTABLE_ASCII = "^[\\x21-\\x7E]+$";

  private InboundLimits() {}
}
