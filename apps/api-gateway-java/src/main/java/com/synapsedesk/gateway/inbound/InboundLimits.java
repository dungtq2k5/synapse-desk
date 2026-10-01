package com.synapsedesk.gateway.inbound;

import java.util.Set;

/**
 * The bounds and allowlist the inbound-email path validates against.
 *
 * <p><b>A second copy, held to the first by a guard.</b> These are
 * {@code libs/common}'s attachment vocabulary and the Node gateway's own
 * {@code dto.config.ts}; the generated Java vocabulary carries neither (it
 * renders string maps, and the DTO bounds are not in the library at all). So
 * they are written here, and {@code scripts/lib/inbound-limits.spec.ts} fails
 * when either side changes — comparing the sets and numbers in both directions,
 * so an added type or a moved bound cannot pass unnoticed.
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

  /** RFC 5322 {@code msg-id} characters: printable ASCII, no space. */
  public static final String PRINTABLE_ASCII = "^[\\x21-\\x7E]+$";

  private InboundLimits() {}
}
