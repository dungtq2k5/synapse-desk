package com.synapsedesk.gateway.inbound;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

/**
 * The two objects Resend gives for one inbound mail — the verified
 * {@code email.received} event, and the email fetched by its id — as far as the
 * mapper reads them.
 *
 * <p>Only what is read is declared, and every other property is ignored: these
 * are a vendor's payloads, and a field Resend adds must not fail a delivery.
 * Every property is nullable because the vendor's own SDK types them so.
 */
public final class ResendPayloads {

  private ResendPayloads() {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Event(
    String type,
    @JsonProperty("created_at") String createdAt,
    Data data
  ) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Data(
      @JsonProperty("email_id") String emailId,
      @JsonProperty("received_for") List<String> receivedFor
    ) {}
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Email(
    String from,
    String subject,
    String text,
    String html,
    @JsonProperty("message_id") String messageId,
    @JsonProperty("received_for") List<String> receivedFor,
    Map<String, String> headers,
    List<Attachment> attachments
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Attachment(
    String id,
    String filename,
    long size,
    @JsonProperty("content_type") String contentType,
    @JsonProperty("content_id") String contentId,
    @JsonProperty("content_disposition") String contentDisposition
  ) {}

  /** One page of the attachments Resend holds for a received mail. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record AttachmentList(
    @JsonProperty("has_more") boolean hasMore,
    List<AttachmentSource> data
  ) {}

  /** Where one attachment can be downloaded from, and until when. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record AttachmentSource(
    String id,
    @JsonProperty("download_url") String downloadUrl,
    @JsonProperty("expires_at") String expiresAt
  ) {}
}
