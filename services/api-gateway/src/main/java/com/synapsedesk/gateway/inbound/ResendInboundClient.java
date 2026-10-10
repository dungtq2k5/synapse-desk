package com.synapsedesk.gateway.inbound;

import com.synapsedesk.gateway.config.InboundEmailProperties;
import com.synapsedesk.gateway.inbound.ResendPayloads.AttachmentList;
import com.synapsedesk.gateway.inbound.ResendPayloads.Email;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Reads a received mail, and its attachment list, from Resend's receiving API.
 *
 * <p><b>Never throws for a vendor failure; answers a {@link Result}</b>, because
 * the caller's whole job is to tell the failures apart: a retryable one must be
 * answered 503 so Resend redelivers, a permanent one 200 so it does not.
 *
 * <p><b>Classifies by the HTTP status.</b> The vendor's own JavaScript SDK reads the
 * error out of the JSON body and ignores the status; a client that reads the
 * status agrees with it for every answer the API really gives (its error bodies
 * carry {@code statusCode}) and does not misread a proxy's HTML page. A
 * connection that dies with no answer has no status and is the vendor never
 * answering — retryable, and no verdict on the mail.
 *
 * <p>Bounded: a connect timeout and a request timeout, so a vendor that accepts
 * the connection and then says nothing is a retryable failure and not a request
 * thread held open.
 */
@Component
public class ResendInboundClient {

  private static final String ATTEMPT_LIMIT_PROPERTY =
    "jdk.httpclient.redirects.retrylimit";
  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);
  private static final String APPLICATION_ERROR = "application_error";
  private static final String CONCURRENT_IDEMPOTENT =
    "concurrent_idempotent_requests";

  /** The most attachments one list call returns; the default of 20 would miss page two. */
  public static final int ATTACHMENT_PAGE_LIMIT = 100;

  static {
    // One attempt per call. The JDK client retries an idempotent GET whose
    // connection dies before any response byte — a second request the vendor
    // counts against the account's rate limit, for a mail Resend redelivers
    // anyway. The knob is the JDK's attempt limit (its name says redirects; it
    // bounds both), read once when the HTTP classes first load, so it is set here,
    // before any request, and only when the operator has not chosen otherwise.
    // It is GLOBAL to the JVM, set for this one caller: whoever adds a second
    // HTTP client on the JDK stack inherits it, and should know why it is there.
    // `ResendInboundClientTest` pins the observable result, so a JDK that reads
    // it differently fails that test rather than quietly retrying.
    if (System.getProperty(ATTEMPT_LIMIT_PROPERTY) == null) {
      System.setProperty(ATTEMPT_LIMIT_PROPERTY, "1");
    }
  }

  // HTTP/1.1: the default offers an h2c upgrade on a plain-http URL, which a
  // vendor's proxy may not answer the way the real API does.
  private final HttpClient http = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_1_1)
    .connectTimeout(CONNECT_TIMEOUT)
    .build();
  private final String baseUrl;
  private final String apiKey;
  private final ObjectMapper json;

  public ResendInboundClient(
    InboundEmailProperties properties,
    ObjectMapper json
  ) {
    this.baseUrl = properties.resendBaseUrl().replaceAll("/+$", "");
    this.apiKey = properties.resendApiKey();
    this.json = json;
  }

  /**
   * Why a call failed.
   *
   * @param name the vendor's error name when its body gave one, else
   *     {@code application_error}
   * @param statusCode the HTTP status, or {@code null} when nothing answered
   */
  public record Failure(String name, Integer statusCode) {
    /**
     * Whether trying again could change the answer — {@code isRetryableResendError}.
     * A 429, a 5xx, a concurrent-idempotency conflict, and a call that was never
     * answered are; a 404 or a wrongly scoped key fails identically every time.
     */
    public boolean retryable() {
      if (CONCURRENT_IDEMPOTENT.equals(name)) return true;

      return statusCode == null
        ? APPLICATION_ERROR.equals(name)
        : statusCode == 429 || statusCode >= 500;
    }

    /** {@code name (status)}, for a log line; the body of the mail is never in it. */
    public String describe() {
      return (
        name + " (" + (statusCode == null ? "no status" : statusCode) + ")"
      );
    }
  }

  /** What a call produced: the data, or the failure. Exactly one is non-null. */
  public record Result<T>(T data, Failure failure) {
    static <T> Result<T> ok(T data) {
      return new Result<>(data, null);
    }

    static <T> Result<T> failed(Failure failure) {
      return new Result<>(null, failure);
    }
  }

  /** {@code GET /emails/receiving/{id}}. */
  public Result<Email> getEmail(String emailId) {
    return get("/emails/receiving/" + segment(emailId), Email.class);
  }

  /** {@code GET /emails/receiving/{id}/attachments?limit=100}. */
  public Result<AttachmentList> listAttachments(String emailId) {
    return get(
      "/emails/receiving/" +
        segment(emailId) +
        "/attachments?limit=" +
        ATTACHMENT_PAGE_LIMIT,
      AttachmentList.class
    );
  }

  private <T> Result<T> get(String path, Class<T> type) {
    HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
      .timeout(REQUEST_TIMEOUT)
      .header("Authorization", "Bearer " + apiKey)
      .header("Accept", "application/json")
      .GET()
      .build();

    HttpResponse<String> response;
    try {
      response = http.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
      );
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return Result.failed(new Failure(APPLICATION_ERROR, null));
    } catch (IOException noAnswer) {
      return Result.failed(new Failure(APPLICATION_ERROR, null));
    }

    int status = response.statusCode();
    if (status >= 400) {
      return Result.failed(new Failure(errorName(response.body()), status));
    }

    try {
      T data = json.readValue(response.body(), type);

      return data == null
        ? Result.failed(new Failure(APPLICATION_ERROR, status))
        : Result.ok(data);
    } catch (RuntimeException unreadable) {
      return Result.failed(new Failure(APPLICATION_ERROR, status));
    }
  }

  /** The vendor's error {@code name}, or {@code application_error} for a body that has none. */
  private String errorName(String body) {
    try {
      JsonNode name = json.readTree(body).get("name");
      if (name != null && name.isString() && !name.asString().isEmpty()) {
        return name.asString();
      }
    } catch (RuntimeException notJson) {
      // A proxy's HTML page: not the vendor's error shape, so it has no name.
    }

    return APPLICATION_ERROR;
  }

  private static String segment(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }
}
