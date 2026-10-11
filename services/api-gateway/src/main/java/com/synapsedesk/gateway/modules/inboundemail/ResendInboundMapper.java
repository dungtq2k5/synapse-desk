package com.synapsedesk.gateway.modules.inboundemail;

import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.Attachment;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.Email;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.Event;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Builds the inbound mail {@code accept()} takes from Resend's two objects: the
 * verified {@code email.received} event and the email fetched by its id.
 *
 * <p>Field by field:
 *
 * <ul>
 *   <li><b>{@code to}</b> is the first {@code received_for} entry on the inbound
 *       domain — the ENVELOPE recipients, so a mail that reached the tenant
 *       address by BCC or through a list still routes, where the {@code To:}
 *       header would name somebody else. None on the domain yields {@code ""},
 *       which nothing routes, so a local part on a foreign domain is never
 *       routed.
 *   <li><b>{@code from}</b> is the bare, lower-cased address and {@code fromName}
 *       the display name before {@code <…>}.
 *   <li><b>{@code messageId}</b> is {@code message_id} as given; empty is absent.
 *   <li><b>{@code inReplyTo}</b>, <b>{@code references}</b> (split on
 *       whitespace) and <b>{@code date}</b> come from the headers, read
 *       case-insensitively; a missing or empty header is absent.
 *   <li><b>{@code headers}</b> carries only {@code auto-submitted} and {@code
 *       precedence}: a full copy is unbounded sender-controlled data with one
 *       use, the loop guards.
 *   <li><b>attachments split three ways</b> ({@link #splitAttachments}).
 * </ul>
 *
 * <p>Pure: no I/O, and the output is NOT validated here — the caller validates
 * it, because nothing else will.
 */
public final class ResendInboundMapper {

  /** What a nameless attachment is called in the ticket's dropped-files note. */
  public static final String UNNAMED_ATTACHMENT = "(unnamed)";

  private static final String TRUNCATION_MARK = "…";
  private static final List<String> LOOP_HEADERS = List.of(
    "auto-submitted",
    "precedence"
  );
  private static final Pattern QUOTED = Pattern.compile(
    "\"([^\\n\\r\\u2028\\u2029]*)\""
  );

  private ResendInboundMapper() {}

  /** What the mapper produced, plus what the caller logs about it. */
  public record Mapped(
    InboundEmail fields,
    /** How many {@code received_for} entries were on the inbound domain; the first wins. */
    int tenantRecipientCount
  ) {}

  public static Mapped toMapped(
    Event event,
    Email email,
    String inboundDomain
  ) {
    String domain = inboundDomain.toLowerCase(Locale.ROOT);
    List<String> receivedFor =
      email.receivedFor() != null
        ? email.receivedFor()
        : event.data() != null && event.data().receivedFor() != null
          ? event.data().receivedFor()
          : List.of();
    List<String> recipients = receivedFor
      .stream()
      .map(EmailAddresses::extractEmailAddress)
      .filter(address ->
        domain.equals(EmailAddresses.extractEmailDomain(address))
      )
      .toList();

    Map<String, String> byName = headersByName(email.headers());
    Map<String, String> loopHeaders = new LinkedHashMap<>();
    for (String name : LOOP_HEADERS) {
      String value = headerValue(byName, name);
      if (value != null) loopHeaders.put(name, value);
    }
    String referencesHeader = headerValue(byName, "references");
    String from = email.from() == null ? "" : email.from();
    String fromName = displayNameOf(from);
    Capped text = capBody(email.text());
    Capped html = capBody(email.html());
    Split split = splitAttachments(
      email.attachments() == null ? List.of() : email.attachments()
    );

    return new Mapped(
      new InboundEmail(
        email.messageId() == null || email.messageId().isEmpty()
          ? null
          : email.messageId(),
        recipients.isEmpty() ? "" : recipients.get(0),
        EmailAddresses.extractEmailAddress(from),
        fromName,
        email.subject() == null ? "" : email.subject(),
        text.value(),
        html.value(),
        headerValue(byName, "in-reply-to"),
        referencesHeader == null
          ? List.of()
          : JsText.splitOnWhitespace(referencesHeader),
        loopHeaders.isEmpty() ? null : loopHeaders,
        split.droppedAttachments(),
        split.remoteAttachments(),
        List.of(),
        headerValue(byName, "date"),
        event.createdAt(),
        text.truncated() || html.truncated()
      ),
      recipients.size()
    );
  }

  /** A body, and whether {@link #capBody} cut it. */
  public record Capped(String value, boolean truncated) {}

  /**
   * A body cut to {@link InboundLimits#MAX_INBOUND_BODY_LENGTH} UTF-16 code units,
   * and whether it was.
   *
   * <p><b>Applied here, where the fetched mail enters</b>, because the point is to
   * bound what the quadratic patterns downstream are given: a cap beside the
   * constraints on {@link InboundEmail} would run after they had already scanned
   * it.
   *
   * <p>Never splits a surrogate pair: a cut that lands between the two halves of an
   * astral character is moved one unit earlier, so the result is always well
   * formed.
   */
  public static Capped capBody(String value) {
    if (
      value == null || value.length() <= InboundLimits.MAX_INBOUND_BODY_LENGTH
    ) {
      return new Capped(value, false);
    }

    int end = InboundLimits.MAX_INBOUND_BODY_LENGTH;
    boolean splitsAPair =
      Character.isHighSurrogate(value.charAt(end - 1)) &&
      Character.isLowSurrogate(value.charAt(end));
    if (splitsAPair) end -= 1;

    return new Capped(value.substring(0, end), true);
  }

  /** Resend's attachments, split into the ones worth fetching and the names of the rest. */
  public record Split(
    List<InboundEmail.RemoteAttachment> remoteAttachments,
    List<String> droppedAttachments
  ) {}

  /**
   * Every check here mirrors a rule on {@link InboundEmail.RemoteAttachment}, and
   * runs first because a nested failure is mail-fatal: the handler answers any
   * validation failure by dropping the WHOLE mail. So an attachment that would
   * fail a rule is named as dropped instead, and the constraints stay a
   * backstop.
   *
   * <p>Dropped when: {@code inline} with a {@code content_id} (part of the HTML
   * body); its type, parameters stripped, is outside the allowlist; {@code size}
   * below 1; its name exceeds the bound (the note truncates it); or it comes after
   * the first {@code MAX_PRESENTED_ATTACHMENTS} eligible ones.
   */
  public static Split splitAttachments(List<Attachment> attachments) {
    List<InboundEmail.RemoteAttachment> remote = new ArrayList<>();
    List<String> dropped = new ArrayList<>();

    for (Attachment attachment : attachments) {
      String fileName =
        attachment.filename() == null || attachment.filename().isEmpty()
          ? UNNAMED_ATTACHMENT
          : attachment.filename();
      String mimeType = normalizeMimeType(attachment.contentType());
      boolean inlineImage =
        "inline".equals(attachment.contentDisposition()) &&
        attachment.contentId() != null &&
        !attachment.contentId().isEmpty();
      boolean eligible =
        !inlineImage &&
        InboundLimits.ALLOWED_ATTACHMENT_MIME_TYPES.contains(mimeType) &&
        attachment.size() >= 1 &&
        fileName.length() <= InboundLimits.MAX_ATTACHMENT_FILE_NAME_LENGTH &&
        remote.size() < InboundLimits.MAX_PRESENTED_ATTACHMENTS;

      if (eligible) {
        remote.add(
          new InboundEmail.RemoteAttachment(
            attachment.id(),
            fileName,
            mimeType,
            attachment.size()
          )
        );
      } else {
        dropped.add(truncatedName(fileName));
      }
    }

    return new Split(remote, dropped);
  }

  /** {@code Image/PNG; name="a.png"} → {@code image/png}. */
  private static String normalizeMimeType(String contentType) {
    String type = contentType == null ? "" : contentType;
    int semicolon = type.indexOf(';');

    return JsText.trim(
      semicolon < 0 ? type : type.substring(0, semicolon)
    ).toLowerCase(Locale.ROOT);
  }

  /** A name that fits the note's column, ending in {@code …} when it was cut. */
  private static String truncatedName(String fileName) {
    if (
      fileName.length() <= InboundLimits.MAX_ATTACHMENT_FILE_NAME_LENGTH
    ) return fileName;

    return (
      fileName.substring(
        0,
        InboundLimits.MAX_ATTACHMENT_FILE_NAME_LENGTH - TRUNCATION_MARK.length()
      ) + TRUNCATION_MARK
    );
  }

  /** A case-insensitive, trimmed view of Resend's header record. */
  private static Map<String, String> headersByName(
    Map<String, String> headers
  ) {
    Map<String, String> byName = new LinkedHashMap<>();
    if (headers == null) return byName;

    headers.forEach((name, value) ->
      byName.put(
        name.toLowerCase(Locale.ROOT),
        JsText.trim(String.valueOf(value))
      )
    );

    return byName;
  }

  /** The header's value, or {@code null} when it is absent OR empty. */
  private static String headerValue(Map<String, String> byName, String name) {
    String value = byName.get(name);

    return value == null || value.isEmpty() ? null : value;
  }

  /** The display name of a {@code From} value, or {@code null}. */
  private static String displayNameOf(String from) {
    int angle = from.indexOf('<');
    if (angle <= 0) return null;

    String name = JsText.trim(from.substring(0, angle));
    // `/^"(.*)"$/`: `.` stops at a line terminator, so a quoted name that
    // contains one keeps its quotes.
    Matcher quoted = QUOTED.matcher(name);
    if (quoted.matches()) name = JsText.trim(quoted.group(1));

    return name.isEmpty() ? null : name;
  }
}
