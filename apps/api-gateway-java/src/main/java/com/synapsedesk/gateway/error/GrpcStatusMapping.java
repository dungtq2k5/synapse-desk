package com.synapsedesk.gateway.error;

import io.grpc.Status;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * A gRPC failure, as a client sees it — the Node gateway's
 * `client-safe-message.ts`, reproduced.
 *
 * <p><b>Gap 38, and it is the reason this is not just a status table.</b> The
 * three codes grpc generates ITSELF — a peer that is down, a deadline, a
 * cancelled call — carry details naming the peer's ADDRESS. Forwarding those
 * tells a client the shape of the private network. So a transport-class code
 * answers a FIXED message in every environment, production or not.
 *
 * <p>The exception is a message a service deliberately wrote for the user:
 * `withHttpStatus` prefixes it with `[http:NNN]`, and a marked message is
 * forwarded with the marked status. That marker is the whole channel — a
 * service cannot otherwise make its own text reach a client.
 */
public final class GrpcStatusMapping {

  private GrpcStatusMapping() {}

  /** The same marker `withHttpStatus` writes, and the same 100–599 guard. */
  private static final Pattern MARKER = Pattern.compile("^\\[http:(\\d{3})]\\s*");

  private static final Map<Status.Code, HttpStatus> TO_HTTP =
      new EnumMap<>(Status.Code.class);

  /**
   * What a client is told for a transport-class failure nobody vouched for.
   *
   * <p>No trailing punctuation here: {@link ErrorMessages#format} adds the
   * `!`, exactly as the Node side does.
   */
  private static final Map<Status.Code, String> TRANSPORT =
      new EnumMap<>(Status.Code.class);

  static {
    TO_HTTP.put(Status.Code.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST);
    TO_HTTP.put(Status.Code.FAILED_PRECONDITION, HttpStatus.BAD_REQUEST);
    TO_HTTP.put(Status.Code.OUT_OF_RANGE, HttpStatus.BAD_REQUEST);
    TO_HTTP.put(Status.Code.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED);
    TO_HTTP.put(Status.Code.PERMISSION_DENIED, HttpStatus.FORBIDDEN);
    TO_HTTP.put(Status.Code.NOT_FOUND, HttpStatus.NOT_FOUND);
    TO_HTTP.put(Status.Code.ALREADY_EXISTS, HttpStatus.CONFLICT);
    TO_HTTP.put(Status.Code.ABORTED, HttpStatus.CONFLICT);
    TO_HTTP.put(Status.Code.RESOURCE_EXHAUSTED, HttpStatus.TOO_MANY_REQUESTS);
    TO_HTTP.put(Status.Code.CANCELLED, HttpStatus.REQUEST_TIMEOUT);
    TO_HTTP.put(Status.Code.UNIMPLEMENTED, HttpStatus.NOT_IMPLEMENTED);
    TO_HTTP.put(Status.Code.UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
    TO_HTTP.put(Status.Code.DEADLINE_EXCEEDED, HttpStatus.GATEWAY_TIMEOUT);

    TRANSPORT.put(
        Status.Code.UNAVAILABLE,
        "A service this request depends on is unavailable. Try again shortly");
    TRANSPORT.put(
        Status.Code.DEADLINE_EXCEEDED,
        "A service this request depends on took too long to answer. Try again shortly");
    TRANSPORT.put(
        Status.Code.CANCELLED, "The request was cancelled before a service answered. Try again");
  }

  /** What the client is told, status and message, for one gRPC failure. */
  public record ClientSafe(HttpStatus status, String message) {}

  /**
   * Resolves one gRPC failure.
   *
   * <p>Order matters, and it is the Node side's: the marker wins over the
   * table, and the fixed transport message applies only when there is NO
   * marker. A marked `UNAVAILABLE` is a service saying something deliberate
   * while its peer happened to be down, and that text is forwarded.
   */
  public static ClientSafe resolve(Status.Code code, String description) {
    String text = description == null ? "" : description;
    Optional<Integer> marked = markedStatus(text);
    HttpStatus mapped = TO_HTTP.getOrDefault(code, HttpStatus.INTERNAL_SERVER_ERROR);

    if (marked.isPresent()) {
      return new ClientSafe(
          HttpStatus.valueOf(marked.get()), ErrorMessages.format(stripMarker(text)));
    }

    String fixed = TRANSPORT.get(code);
    if (fixed != null) {
      return new ClientSafe(mapped, ErrorMessages.format(fixed));
    }

    return new ClientSafe(mapped, ErrorMessages.format(text));
  }

  /** The status a `[http:NNN]` marker asks for, if it asks for a plausible one. */
  private static Optional<Integer> markedStatus(String message) {
    Matcher matcher = MARKER.matcher(message);
    if (!matcher.find()) {
      return Optional.empty();
    }

    int status = Integer.parseInt(matcher.group(1));

    // A marker outside the plausible range is ordinary text, not an
    // instruction: a message that happens to start with `[http:999]` must not
    // be able to choose its own status code.
    return status < 100 || status > 599 ? Optional.empty() : Optional.of(status);
  }

  private static String stripMarker(String message) {
    Matcher matcher = MARKER.matcher(message);

    return matcher.find() ? message.substring(matcher.end()) : message;
  }
}
