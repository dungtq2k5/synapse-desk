package com.synapsedesk.gateway.inbound;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

/**
 * One inbound mail, as {@code accept()} takes it — the Node gateway's
 * {@code InboundEmailDto}, constraint for constraint.
 *
 * <p><b>Validated by hand by the caller</b>, with a {@code Validator}: this is
 * built from a fetched mail, not received as a request body, so nothing else
 * will. A violation answers the webhook {@code 200 invalid_payload} — the mail
 * is dropped and visible in the counter, because Resend would retry a non-2xx
 * for hours to no effect.
 *
 * <p><b>Absent and empty are the same here.</b> The Node DTO defaults its list
 * fields to {@code []}; a record has no field initialisers, so the constructor
 * normalises a missing list to empty, which is what a fixture that omits one
 * deserialises to.
 *
 * <p>{@code text} and {@code html} are required to be PRESENT but may be null in
 * Node, because "no text part" and "the field was forgotten" are different
 * facts. A record always has the component, so the distinction is carried by the
 * type and needs no constraint.
 */
public record InboundEmail(
  @Pattern(
    regexp = InboundLimits.PRINTABLE_ASCII,
    message = "messageId must be printable ASCII (RFC 5322 msg-id)"
  )
  @Size(max = InboundLimits.MAX_MESSAGE_ID_LENGTH)
  String messageId,
  @NotNull @Size(max = InboundLimits.MAX_EMAIL_ADDRESS_LENGTH) String to,
  @NotNull
  @StrictEmail
  @Size(max = InboundLimits.MAX_EMAIL_ADDRESS_LENGTH)
  String from,
  @Size(max = InboundLimits.MAX_FULL_NAME_LENGTH) String fromName,
  @NotNull @Size(max = InboundLimits.MAX_HEADER_LINE_LENGTH) String subject,
  String text,
  String html,
  @Size(max = InboundLimits.MAX_MESSAGE_ID_LENGTH) String inReplyTo,
  List<@Size(max = InboundLimits.MAX_MESSAGE_ID_LENGTH) String> references,
  Map<String, String> headers,
  List<String> droppedAttachments,
  @Size(max = InboundLimits.MAX_PRESENTED_ATTACHMENTS)
  List<@Valid RemoteAttachment> remoteAttachments,
  @Size(max = InboundLimits.MAX_ATTACHMENTS_PER_MESSAGE)
  List<@Valid UploadedAttachment> attachments,
  @Size(max = InboundLimits.MAX_DATE_HEADER_LENGTH) String date,
  @NotNull @StrictIso8601 String receivedAt,
  Boolean bodyTruncated
) {
  public InboundEmail {
    references = references == null ? List.of() : references;
    droppedAttachments =
      droppedAttachments == null ? List.of() : droppedAttachments;
    remoteAttachments =
      remoteAttachments == null ? List.of() : remoteAttachments;
    attachments = attachments == null ? List.of() : attachments;
    // Boxed, and normalised here: a mapper that never says it cut a body, and a
    // fixture that omits the key, both mean it did not. A primitive would make
    // Jackson refuse the absent key.
    bodyTruncated = Boolean.TRUE.equals(bodyTruncated);
  }

  /**
   * A mail whose body was NOT cut — the shape every caller that has not met the
   * cap builds. {@code bodyTruncated} says {@code text} or {@code html} was cut at
   * {@link InboundLimits#MAX_INBOUND_BODY_LENGTH} by the mapper, so the ticket can
   * say the body was shortened.
   */
  public InboundEmail(
    String messageId,
    String to,
    String from,
    String fromName,
    String subject,
    String text,
    String html,
    String inReplyTo,
    List<String> references,
    Map<String, String> headers,
    List<String> droppedAttachments,
    List<RemoteAttachment> remoteAttachments,
    List<UploadedAttachment> attachments,
    String date,
    String receivedAt
  ) {
    this(
      messageId,
      to,
      from,
      fromName,
      subject,
      text,
      html,
      inReplyTo,
      references,
      headers,
      droppedAttachments,
      remoteAttachments,
      attachments,
      date,
      receivedAt,
      false
    );
  }

  /** An attachment still to be fetched — it has no URL yet; that is read after routing. */
  public record RemoteAttachment(
    @NotNull
    @Size(min = 1, max = InboundLimits.MAX_MESSAGE_ID_LENGTH)
    String id,
    @NotNull
    @Size(min = 1, max = InboundLimits.MAX_ATTACHMENT_FILE_NAME_LENGTH)
    String fileName,
    @NotNull @AllowedAttachmentType String mimeType,
    @Min(1) long sizeBytes
  ) {}

  /** An attachment already stored, by its object path. */
  public record UploadedAttachment(
    @NotNull
    @Size(min = 1, max = InboundLimits.MAX_OBJECT_PATH_LENGTH)
    String objectPath,
    @NotNull
    @Size(min = 1, max = InboundLimits.MAX_ATTACHMENT_FILE_NAME_LENGTH)
    String fileName
  ) {}
}
