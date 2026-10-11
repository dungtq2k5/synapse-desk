package com.synapsedesk.gateway.modules.inboundemail;

import com.synapsedesk.gateway.common.config.InboundEmailProperties;
import com.synapsedesk.gateway.common.metrics.GatewayMetrics;
import com.synapsedesk.gateway.modules.inboundemail.InboundEmailService.AcceptOptions;
import com.synapsedesk.gateway.modules.inboundemail.InboundEmailService.RemoteAttachmentSource;
import com.synapsedesk.gateway.modules.inboundemail.ResendInboundClient.Failure;
import com.synapsedesk.gateway.modules.inboundemail.ResendInboundClient.Result;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.AttachmentList;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.AttachmentSource;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.Email;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.Event;
import com.synapsedesk.gateway.modules.inboundemail.dto.rest.ResendWebhookAcknowledgementDto;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Turns one Resend {@code email.received} delivery into an
 * {@link InboundEmailService#accept} call.
 *
 * <p>Every exit increments {@code inbound_email_webhook_total{outcome}} exactly
 * once:
 *
 * <table>
 *   <caption>The webhook's exits</caption>
 *   <tr><th>Exit</th><th>HTTP</th><th>{@code outcome}</th></tr>
 *   <tr><td>no raw body (a filter that did not capture it)</td><td>401</td><td>{@code no_raw_body}</td></tr>
 *   <tr><td>a missing {@code svix-*} header, or the signature fails</td><td>401</td><td>{@code rejected_signature}</td></tr>
 *   <tr><td>a verified event that is not {@code email.received}</td><td>200</td><td>{@code ignored_event}</td></tr>
 *   <tr><td>a retryable fetch error (429, 5xx, no answer)</td><td>503</td><td>{@code fetch_failed}</td></tr>
 *   <tr><td>a fetch error a retry will not change (404, 401)</td><td>200</td><td>{@code fetch_failed}</td></tr>
 *   <tr><td>the mapped mail fails validation</td><td>200</td><td>{@code invalid_payload}</td></tr>
 *   <tr><td>{@code accept()} ran</td><td>200</td><td>its {@link InboundOutcome}</td></tr>
 * </table>
 *
 * <p><b>Nothing unauthenticated causes work.</b> The signature is checked before
 * any call to Resend or any gRPC peer, and nothing from a rejected body is logged.
 *
 * <p><b>200 after verification unless a retry can help.</b> Resend redelivers any
 * non-2xx for about 17.6 hours, so a mail this system decided to drop, a mail that
 * cannot pass validation, and a fetch that will fail identically all answer 200
 * and are visible in the counter instead.
 */
@Service
public class ResendInboundService {

  private static final Logger LOG = LoggerFactory.getLogger(
    ResendInboundService.class
  );

  /** The Standard Webhooks headers Resend signs a delivery with. */
  static final String SVIX_ID = "svix-id";
  static final String SVIX_TIMESTAMP = "svix-timestamp";
  public static final String SVIX_SIGNATURE = "svix-signature";
  /** Who calls this intake. */
  public static final String CALLER = "resend";

  /**
   * The longest signed URL passed on to storage-service — validator.js's default
   * {@code isURL} bound, measured: a 2 100-character https URL is refused at it.
   */
  static final int MAX_SOURCE_URL_LENGTH = 2_084;

  /** Webhook exits that happen before, or instead of, {@code accept()}. */
  static final String NO_RAW_BODY = "no_raw_body";
  static final String REJECTED_SIGNATURE = "rejected_signature";
  static final String IGNORED_EVENT = "ignored_event";
  static final String FETCH_FAILED = "fetch_failed";
  static final String INVALID_PAYLOAD = "invalid_payload";

  private static final String EMAIL_RECEIVED = "email.received";

  private final ResendInboundClient resend;
  private final InboundEmailService inbound;
  private final GatewayMetrics metrics;
  private final Validator validator;
  private final InboundEmailProperties properties;
  private final ObjectMapper json;

  public ResendInboundService(
    ResendInboundClient resend,
    InboundEmailService inbound,
    GatewayMetrics metrics,
    Validator validator,
    InboundEmailProperties properties,
    ObjectMapper json
  ) {
    this.resend = resend;
    this.inbound = inbound;
    this.metrics = metrics;
    this.validator = validator;
    this.properties = properties;
    this.json = json;
  }

  /**
   * Handles one delivery; see the class docs for every exit.
   *
   * @param rawBody the exact bytes received — the signature is over these — or
   *     {@code null} when the filter that captures them did not
   * @param header reads one request header
   * @throws ResponseStatusException 401 when the body is missing or the signature
   *     does not verify; 503 when fetching the mail failed in a way a later retry
   *     can fix
   */
  public ResendWebhookAcknowledgementDto handle(
    byte[] rawBody,
    Function<String, String> header
  ) {
    if (rawBody == null) {
      // A CONFIGURATION failure, not a caller one. Saying so is what stops
      // somebody regenerating a secret that was never the problem.
      LOG.error(
        "Resend webhook received no raw body — the request body must be captured before the controller runs"
      );
      throw reject(NO_RAW_BODY);
    }

    Event event = verify(rawBody, header);
    if (event == null) throw reject(REJECTED_SIGNATURE);

    if (!EMAIL_RECEIVED.equals(event.type())) return ok(IGNORED_EVENT);

    String emailId = event.data() == null ? null : event.data().emailId();
    if (emailId == null || emailId.isEmpty()) {
      LOG.error(
        "Resend delivered an email.received with no email id, dropping it"
      );

      return ok(FETCH_FAILED);
    }

    Result<Email> fetched = resend.getEmail(emailId);

    if (fetched.failure() != null) {
      Failure failure = fetched.failure();

      if (failure.retryable()) {
        LOG.warn(
          "Could not fetch inbound mail {}, asking Resend to retry: {}",
          emailId,
          failure.describe()
        );
        count(FETCH_FAILED);

        throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "Inbound mail fetch failed"
        );
      }

      // A 404 or a wrongly scoped key fails identically on every retry, so it is
      // answered 200 and left to the counter; the log line names the cause.
      LOG.error(
        "Could not fetch inbound mail {}, dropping it: {}",
        emailId,
        failure.describe()
      );

      return ok(FETCH_FAILED);
    }

    ResendInboundMapper.Mapped mapped = ResendInboundMapper.toMapped(
      event,
      fetched.data(),
      properties.domain()
    );

    if (mapped.tenantRecipientCount() > 1) {
      LOG.warn(
        "Inbound mail {} reached {} tenant addresses; routing by the first",
        emailId,
        mapped.tenantRecipientCount()
      );
    }

    if (mapped.fields().bodyTruncated()) {
      LOG.warn(
        "Inbound mail {} had a body over {} characters; it was shortened",
        emailId,
        InboundLimits.MAX_INBOUND_BODY_LENGTH
      );
    }

    // Validated by hand, because nothing else will: this object is built here, not
    // received as a request body, so no framework binder ever sees it.
    Set<ConstraintViolation<InboundEmail>> violations = validator.validate(
      mapped.fields()
    );
    if (!violations.isEmpty()) {
      // The constraint names, never the values — the body is sender-controlled.
      Set<String> properties = new LinkedHashSet<>();
      for (ConstraintViolation<InboundEmail> violation : violations) {
        properties.add(violation.getPropertyPath().iterator().next().getName());
      }
      LOG.warn(
        "Inbound mail {} failed validation on: {}",
        emailId,
        String.join(", ", properties)
      );

      return ok(INVALID_PAYLOAD);
    }

    return ok(
      inbound
        .accept(
          mapped.fields(),
          new AcceptOptions(() -> fetchAttachmentUrls(emailId))
        )
        .wire()
    );
  }

  /**
   * The signed download URL of each of a mail's attachments, by Resend id.
   *
   * <p><b>Called by {@code accept} after routing, never here.</b> A mail that
   * turns out to be unroutable, from a refused sender, or opening a ticket drops
   * every attachment anyway, and a list call spent on it competes with the next
   * mail's fetch under the account's rate limit.
   *
   * <ul>
   *   <li><b>{@code limit: 100}</b>, the API's maximum; the default of 20 would
   *       silently miss page two. If {@code has_more} is still true the rest are
   *       simply absent from the map, and {@code accept} names them as dropped.
   *   <li><b>A URL is only passed on if storage-service could accept it</b>:
   *       {@code https:} and at most {@link #MAX_SOURCE_URL_LENGTH} characters.
   *       Anything else is absent from the map, which drops that file by name
   *       rather than failing.
   *   <li><b>A list error is classified like the mail fetch.</b> Retryable → 503,
   *       so Resend redelivers before anything is written; otherwise an empty map,
   *       so every attachment is named as dropped and the mail is still delivered —
   *       the mail matters more than its attachments.
   * </ul>
   */
  private Map<String, RemoteAttachmentSource> fetchAttachmentUrls(
    String emailId
  ) {
    Result<AttachmentList> listed = resend.listAttachments(emailId);

    if (listed.failure() != null) {
      Failure failure = listed.failure();

      if (failure.retryable()) {
        LOG.warn(
          "Could not list the attachments of {}, asking Resend to retry: {}",
          emailId,
          failure.describe()
        );
        count(FETCH_FAILED);

        throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "Inbound attachment list failed"
        );
      }

      LOG.error(
        "Could not list the attachments of {}; delivering the mail without them: {}",
        emailId,
        failure.describe()
      );

      return Map.of();
    }

    AttachmentList page = listed.data();
    if (page.hasMore()) {
      LOG.warn(
        "Inbound mail {} has more attachments than one page; the rest are named as dropped",
        emailId
      );
    }

    Map<String, RemoteAttachmentSource> sources = new HashMap<>();
    if (page.data() == null) return sources;

    for (AttachmentSource attachment : page.data()) {
      String url = attachment.downloadUrl();
      if (
        url == null ||
        !url.startsWith("https://") ||
        url.length() > MAX_SOURCE_URL_LENGTH
      ) {
        continue;
      }
      sources.put(
        attachment.id(),
        new RemoteAttachmentSource(url, parseInstant(attachment.expiresAt()))
      );
    }

    return sources;
  }

  /**
   * An expiry, or {@code null} when it cannot be read.
   *
   * <p>{@code null} means "not known to be expired": the ingest is attempted
   * and storage-service refuses an expired URL itself. Accepts the
   * ISO 8601 form and the space-separated, short-offset form a database writes.
   */
  static Instant parseInstant(String value) {
    if (value == null) return null;
    String text = value.trim().replace(' ', 'T');
    text = text.replaceFirst("([+-]\\d{2})$", "$1:00");

    try {
      return OffsetDateTime.parse(text).toInstant();
    } catch (DateTimeParseException unreadable) {
      try {
        return Instant.parse(text);
      } catch (DateTimeParseException stillUnreadable) {
        return null;
      }
    }
  }

  /** The verified event, or {@code null} for a missing header, a bad signature or a body that is not an event. */
  private Event verify(byte[] rawBody, Function<String, String> header) {
    String id = header.apply(SVIX_ID);
    String timestamp = header.apply(SVIX_TIMESTAMP);
    String signature = header.apply(SVIX_SIGNATURE);

    if (isBlank(id) || isBlank(timestamp) || isBlank(signature)) return null;

    // Nothing about the body is logged: an unauthenticated caller wrote every byte.
    if (
      !StandardWebhookSignature.verify(
        rawBody,
        id,
        timestamp,
        signature,
        properties.resendWebhookSecret(),
        Instant.now()
      )
    ) {
      LOG.warn(
        "Resend webhook rejected: the signature or timestamp did not verify"
      );

      return null;
    }

    try {
      return json.readValue(rawBody, Event.class);
    } catch (RuntimeException notAnEvent) {
      LOG.warn("Resend webhook rejected: the signed body is not an event");

      return null;
    }
  }

  private static boolean isBlank(String value) {
    return value == null || value.isEmpty();
  }

  private void count(String outcome) {
    metrics.inboundEmail(outcome);
  }

  private ResendWebhookAcknowledgementDto ok(String outcome) {
    count(outcome);

    return new ResendWebhookAcknowledgementDto(true, outcome);
  }

  private ResponseStatusException reject(String outcome) {
    count(outcome);

    return new ResponseStatusException(
      HttpStatus.UNAUTHORIZED,
      "Signature could not be verified"
    );
  }
}
